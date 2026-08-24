<?php

namespace Persi\CatalogEngine\Catalog;

use Persi\CatalogEngine\Api\Configuration;
use Persi\CatalogEngine\Infrastructure\AuditRepository;
use Persi\CatalogEngine\Infrastructure\RunRepository;
use Persi\CatalogEngine\Infrastructure\RunItemRepository;
use Persi\CatalogEngine\Infrastructure\AttributeCandidateRepository;
use Persi\CatalogEngine\Attributes\AttributeDiscovery;
use Persi\CatalogEngine\Support\Lock;
use Persi\CatalogEngine\Support\Performance;
use Persi\CatalogEngine\Support\WorkerLock;
use Persi\CatalogEngine\Activator;

defined( 'ABSPATH' ) || exit;

final class BatchProcessor {
	public const ACTION = 'persi_catalog_process_batch';
	public const GROUP  = 'persi-catalog-engine';

	private RunRepository $runs;
	private AuditRepository $audit;
	private Lock $lock;

	public function __construct() {
		$this->runs  = new RunRepository();
		$this->audit = new AuditRepository();
		$this->lock  = new Lock();
	}

	public function register(): void {
		add_action( self::ACTION, array( $this, 'process' ), 10, 1 );
	}

	public function start( string $mode, string $scope, int $limit, int $user_id, array $modules = array( 'gtin' ), array $selected_ids = array() ) {
		$total_started = Performance::start();
		$metrics = array();
		if ( ! function_exists( 'as_schedule_single_action' ) ) {
			return new \WP_Error( 'action_scheduler_unavailable', 'Action Scheduler não está disponível.' );
		}
		if ( ! Activator::schema_ready() ) {
			return new \WP_Error( 'schema_not_ready', 'As tabelas do Persi Catalog Engine não foram atualizadas. Reative o plugin e tente novamente.' );
		}
		$active_run_id = $this->lock->active_run_id();
		if ( $active_run_id ) {
			return new \WP_Error( 'sync_locked', 'Já existe um processamento em andamento.', array( 'run_id' => $active_run_id ) );
		}

		$started = Performance::start();
		$run_id = $this->runs->create( $mode, $scope, $limit, $user_id, $modules );
		Performance::add( $metrics, 'RUN_CREATE', Performance::elapsed_ms( $started ) );
		if ( ! $run_id ) {
			return new \WP_Error( 'run_creation_failed', 'Não foi possível criar a execução.' );
		}
		if ( ! $this->lock->acquire( $run_id ) ) {
			$this->runs->fail( $run_id, 'LOCK', 'sync_locked', 'Outra execução adquiriu o lock antes da preparação.' );
			return new \WP_Error( 'sync_locked', 'Já existe uma sincronização do Persi Catalog Engine em execução.' );
		}
		$started = Performance::start();
		$items = $this->prepare_queue( $scope, $limit, $modules, $selected_ids );
		Performance::add( $metrics, 'PRODUCT_SELECTION', Performance::elapsed_ms( $started ) );
		if ( is_wp_error( $items ) ) {
			$this->runs->fail( $run_id, 'PRODUCT_SELECTION', $items->get_error_code(), $items->get_error_message() );
			$this->lock->release( $run_id );
			return $items;
		}
		$started = Performance::start();
		if ( $items && ! ( new RunItemRepository() )->add( $run_id, $items, $modules ) ) {
			$this->runs->fail( $run_id, 'QUEUE_INSERT', 'queue_storage_failed', 'Não foi possível preparar a fila de produtos.' );
			$this->lock->release( $run_id );
			return new \WP_Error( 'queue_storage_failed', 'Não foi possível preparar a fila de produtos.' );
		}
		Performance::add( $metrics, 'QUEUE_INSERT', Performance::elapsed_ms( $started ), count( $items ) );
		if ( ! $this->runs->queue_ready( $run_id, count( $items ), $metrics ) ) {
			$this->runs->fail( $run_id, 'QUEUE_INSERT', 'queue_state_update_failed', 'A fila foi criada, mas o estado da execução não pôde ser atualizado.' );
			$this->lock->release( $run_id );
			return new \WP_Error( 'queue_state_update_failed', 'Não foi possível atualizar o estado da fila.' );
		}
		if ( ! $items ) {
			$this->complete( $run_id );
			return $run_id;
		}

		$started = Performance::start();
		$action_id = function_exists( 'as_enqueue_async_action' ) ? as_enqueue_async_action( self::ACTION, array( $run_id ), self::GROUP, true ) : as_schedule_single_action( time() + 1, self::ACTION, array( $run_id ), self::GROUP, true );
		Performance::add( $metrics, 'ACTION_SCHEDULE', Performance::elapsed_ms( $started ) );
		Performance::add( $metrics, 'PREPARATION_TOTAL', Performance::elapsed_ms( $total_started ) );
		$this->runs->metrics( $run_id, $metrics );
		if ( ! $action_id ) {
			$this->runs->fail( $run_id, 'ACTION_SCHEDULER', 'schedule_failed', 'Não foi possível agendar o processamento.' );
			$this->lock->release( $run_id );
			return new \WP_Error( 'schedule_failed', 'Não foi possível agendar o processamento.' );
		}
		return $run_id;
	}

	public function process( int $run_id ): void {
		$worker_lock = new WorkerLock();
		if ( ! $worker_lock->acquire( $run_id ) ) { return; }
		try { $this->process_run( $run_id ); }
		catch ( \Throwable $exception ) {
			$this->runs->fail( $run_id, 'WORKER', 'worker_exception', 'O worker encontrou um erro interno e foi interrompido com segurança.' );
			$this->lock->release( $run_id );
		}
		finally { $worker_lock->release( $run_id ); }
	}

	private function process_run( int $run_id ): void {
		$worker_started = Performance::start();
		$run = $this->runs->get( $run_id );
		if ( ! $run || ! in_array( $run->status, array( 'pending', 'running' ), true ) || ! $this->lock->acquire( $run_id ) ) {
			return;
		}

		$this->runs->mark_running( $run_id );
		$this->lock->refresh( $run_id );
		$remaining = max( 0, (int) $run->total_items - (int) $run->processed );
		$batch     = min( ( new Configuration() )->batch_size(), $remaining );
		if ( 0 === $batch ) {
			$this->complete( $run_id );
			return;
		}

		$items = $this->queue_items( $run_id, absint( $run->cursor_id ), $batch );
		$counters = json_decode( (string) $run->counters, true );
		$counters = is_array( $counters ) ? $counters : array();
		$metrics = json_decode( (string) $run->performance_metrics, true );
		$metrics = is_array( $metrics ) ? $metrics : array();
		if ( 0 === (int) $run->processed ) {
			$created_timestamp = strtotime( (string) $run->created_at . ' UTC' );
			if ( $created_timestamp ) { Performance::add( $metrics, 'WORKER_START_DELAY', max( 0, ( microtime( true ) - $created_timestamp ) * 1000 ) ); }
		}
		$cursor   = (int) $run->cursor_id;
		$handled  = 0;
		$sync     = new GtinSync();
		$discovery = false !== strpos( (string) $run->modules, 'attributes' ) ? new AttributeDiscovery() : null;
		$candidate_repository = $discovery ? new AttributeCandidateRepository() : null;
		$consecutive_api_errors = 0;
		$olist_circuit_open = false;
		$budget_seconds = ( new Configuration() )->worker_budget_seconds();

		foreach ( $items as $queue_item ) {
			if ( $this->runs->is_cancelled( $run_id ) ) { $this->lock->release( $run_id ); return; }
			$item_started = Performance::start();
			if ( $handled >= $remaining ) {
				break;
			}
			$product_id = absint( $queue_item->product_id );
			$item_modules = array_filter( explode( ',', (string) $queue_item->modules ) );
			$product = wc_get_product( $product_id );
			$cursor  = max( $cursor, $product_id );
			if ( ! $product ) {
				continue;
			}
			$this->runs->current( $run_id, $product, 'OLIST_LOOKUP', 'Consultando Olist...' );
			$result = null;
			if ( in_array( 'gtin', $item_modules, true ) ) {
				$result = $olist_circuit_open ? array( 'status' => 'API_ERROR', 'error_code' => 'olist_circuit_open', 'details' => 'OLIST_CIRCUIT_OPEN | Etapa: SKU_LOOKUP | Endpoint: PRODUCT_SEARCH | Consulta não realizada para proteger a API.', 'retry_after' => 60 ) : $sync->process( $product, 'dry-run' === $run->mode );
				$this->merge_metrics( $metrics, is_array( $result['performance'] ?? null ) ? $result['performance'] : array() );
				$audit_started = Performance::start();
				$this->audit->record( $run_id, $product, $result );
				Performance::add( $metrics, 'AUDIT_INSERT', Performance::elapsed_ms( $audit_started ) );
				$status              = (string) $result['status'];
				$counters[ $status ] = absint( $counters[ $status ] ?? 0 ) + 1;
				$consecutive_api_errors = 'API_ERROR' === $status ? $consecutive_api_errors + 1 : 0;
			}
			if ( in_array( 'attributes', $item_modules, true ) && $discovery && $candidate_repository ) {
				$attribute_product = $product->get_parent_id() ? wc_get_product( $product->get_parent_id() ) : $product;
				if ( $attribute_product && ! $candidate_repository->has_product( $run_id, $attribute_product->get_id() ) ) {
					$candidates = $discovery->discover( $attribute_product, ! $result || 'API_ERROR' !== ( $result['status'] ?? '' ) );
					if ( ! $candidates ) {
						$candidates[] = array( 'attribute_key' => 'no_information', 'raw_value' => '', 'normalized_value' => '', 'source' => 'CATALOG_DISCOVERY', 'source_field' => '', 'confidence' => 'REVIEW_REQUIRED', 'status' => 'ATTRIBUTE_NO_VALUE', 'evidence' => 'Nenhuma informação semântica suficiente.', 'rule_id' => 'no_candidate', 'ruleset_version' => \Persi\CatalogEngine\Attributes\DiscoveryRules::VERSION );
					}
					foreach ( $candidates as $candidate ) {
						$candidate_repository->record( $run_id, $attribute_product, $candidate );
						$candidate_status = (string) ( $candidate['status'] ?? 'ATTRIBUTE_SKIPPED' );
						$counters[ $candidate_status ] = absint( $counters[ $candidate_status ] ?? 0 ) + 1;
					}
				}
			}
			$this->merge_metrics( $metrics, Performance::drain() );
			++$handled;
			Performance::add( $metrics, 'TOTAL_ITEM_TIME', Performance::elapsed_ms( $item_started ) );
			$counter_started = Performance::start();
			$this->runs->advance( $run_id, $cursor, (int) $run->processed + $handled, $counters, $metrics, $product, $result ? $this->stage_for_status( (string) $result['status'] ) : 'ATTRIBUTE_DISCOVERY', $result ? $this->message_for_status( (string) $result['status'], 'dry-run' === $run->mode ) : 'Candidatos de atributos analisados.' );
			Performance::add( $metrics, 'RUN_COUNTER_UPDATE', Performance::elapsed_ms( $counter_started ) );
			if ( $consecutive_api_errors >= 5 ) {
				if ( $discovery ) { $olist_circuit_open = true; $consecutive_api_errors = 0; continue; }
				else {
				$this->runs->fail( $run_id, 'OLIST_LOOKUP', 'olist_circuit_open', 'Olist temporariamente indisponível. Processamento interrompido com segurança.' );
				$this->lock->release( $run_id ); return;
				}
			}
			if ( is_array( $result ) && 'olist_rate_limited' === ( $result['error_code'] ?? '' ) ) {
				if ( $discovery ) { $olist_circuit_open = true; continue; }
				$processed = (int) $run->processed + $handled;
				$this->lock->refresh( $run_id );
				// A ação atual ainda consta como ativa; usar unique=true impediria a retomada do mesmo run.
				$next_action = as_schedule_single_action( time() + max( 5, absint( $result['retry_after'] ?? 60 ) ), self::ACTION, array( $run_id ), self::GROUP, false );
				if ( ! $next_action ) { $this->runs->fail( $run_id, 'ACTION_SCHEDULER', 'retry_schedule_failed', 'Não foi possível agendar a retomada após o rate limit.' ); $this->lock->release( $run_id ); }
				return;
			}
			if ( Performance::elapsed_ms( $worker_started ) >= $budget_seconds * 1000 ) { break; }
		}

		$processed = (int) $run->processed + $handled;
		if ( $this->runs->is_cancelled( $run_id ) ) { $this->lock->release( $run_id ); return; }
		$this->runs->advance( $run_id, $cursor, $processed, $counters, $metrics );
		if ( 0 === $handled || $processed >= (int) $run->total_items ) {
			$this->complete( $run_id );
			return;
		}

		$this->lock->refresh( $run_id );
		// Não marcar a continuação como única: o Action Scheduler ainda enxerga o lote atual em execução.
		$next_action = function_exists( 'as_enqueue_async_action' ) ? as_enqueue_async_action( self::ACTION, array( $run_id ), self::GROUP, false ) : as_schedule_single_action( time() + 1, self::ACTION, array( $run_id ), self::GROUP, false );
		if ( ! $next_action ) { $this->runs->fail( $run_id, 'ACTION_SCHEDULER', 'continuation_schedule_failed', 'Não foi possível agendar o próximo lote.' ); $this->lock->release( $run_id ); }
	}

	private function queue_items( int $run_id, int $after_id, int $limit ): array {
		global $wpdb;
		$items_table = $wpdb->prefix . 'persi_catalog_run_items';
		$sql = $wpdb->prepare( "SELECT product_id,parent_product_id,target_type,modules FROM {$items_table} WHERE run_id = %d AND product_id > %d ORDER BY product_id ASC LIMIT %d", $run_id, $after_id, $limit );
		return $wpdb->get_results( $sql );
	}

	private function prepare_queue( string $scope, int $limit, array $modules = array( 'gtin' ), array $selected_ids = array() ) {
		if ( 'selected' === $scope ) { return ( new ManualQueueBuilder() )->build( $selected_ids, $modules ); }
		if ( in_array( 'attributes', $modules, true ) && ! in_array( 'gtin', $modules, true ) ) { $scope = 'all'; }
		global $wpdb;
		$lookup_table = $wpdb->prefix . 'wc_product_meta_lookup';

		$scope_sql = '';
		if ( in_array( $scope, array( 'missing-unchecked', 'missing-gtin' ), true ) ) {
			$scope_sql = " AND (lookup.global_unique_id IS NULL OR lookup.global_unique_id = '')";
		}
		if ( 'missing-unchecked' === $scope ) {
			$logs_table = $wpdb->prefix . 'persi_catalog_logs';
			$scope_sql .= " AND NOT EXISTS (
				SELECT 1 FROM {$logs_table} AS previous_empty
				WHERE previous_empty.product_id = posts.ID
				AND previous_empty.status = 'OLIST_NO_GTIN'
			)";
		}
		if ( 'failures' === $scope ) {
			$logs_table = $wpdb->prefix . 'persi_catalog_logs';
			$scope_sql .= " AND EXISTS (SELECT 1 FROM {$logs_table} AS failed_log WHERE failed_log.product_id=posts.ID AND failed_log.status IN ('API_ERROR','INVALID_GTIN','OLIST_NOT_FOUND'))";
		}

		$sql = $wpdb->prepare(
			"SELECT posts.ID, posts.post_parent, posts.post_type
			FROM {$wpdb->posts} AS posts
			LEFT JOIN {$lookup_table} AS lookup ON posts.ID = lookup.product_id
			WHERE posts.post_type IN ('product','product_variation')
			AND posts.post_status IN ('publish','private')
			{$scope_sql}
			ORDER BY posts.ID ASC
			LIMIT %d",
			$limit
		);
		$rows = $wpdb->get_results( $sql );
		if ( '' !== $wpdb->last_error ) { return new \WP_Error( 'db_query_error', 'Falha no banco ao selecionar produtos para a fila.' ); }
		return array_map( static function ( object $row ): array {
			return array( 'product_id' => absint( $row->ID ), 'parent_product_id' => absint( $row->post_parent ), 'target_type' => 'product_variation' === $row->post_type ? 'variation' : 'product' );
		}, $rows );
	}

	private function complete( int $run_id ): void {
		if ( $this->runs->is_cancelled( $run_id ) ) { $this->lock->release( $run_id ); return; }
		$run = $this->runs->get( $run_id ); $counters = $run ? json_decode( (string) $run->counters, true ) : array(); $counters = is_array( $counters ) ? $counters : array();
		$attribute_total = 0; foreach ( $counters as $status => $total ) { if ( 0 === strpos( (string) $status, 'ATTRIBUTE_' ) ) { $attribute_total += absint( $total ); } }
		$this->runs->finish( $run_id, ! empty( $counters['API_ERROR'] ) && $attribute_total > 0 ? 'partial_success' : 'completed' );
		$this->lock->release( $run_id );
		update_option( 'persi_catalog_last_run_id', $run_id, false );
	}

	private function stage_for_status( string $status ): string {
		return array(
			'WOULD_UPDATE' => 'GTIN_WOULD_UPDATE', 'UPDATED' => 'GTIN_UPDATED', 'ALREADY_SYNCED' => 'ALREADY_SYNCED',
			'OLIST_NO_GTIN' => 'OLIST_NO_GTIN', 'GTIN_CONFLICT' => 'GTIN_CONFLICT', 'API_ERROR' => 'API_ERROR',
		)[ $status ] ?? 'GTIN_VALIDATING';
	}

	private function message_for_status( string $status, bool $dry_run ): string {
		$messages = array(
			'WOULD_UPDATE' => 'GTIN encontrado — atualização simulada.', 'UPDATED' => 'GTIN atualizado.',
			'ALREADY_SYNCED' => 'GTIN já está sincronizado.', 'OLIST_NO_GTIN' => 'Produto encontrado, mas sem GTIN no Olist.',
			'GTIN_CONFLICT' => 'GTIN diferente encontrado — enviado para revisão.', 'API_ERROR' => 'Não foi possível consultar o Olist.',
			'OLIST_NOT_FOUND' => 'SKU não encontrado no Olist.', 'INVALID_GTIN' => 'Olist retornou um GTIN inválido.', 'NO_SKU' => 'Produto sem SKU.',
		);
		return $messages[ $status ] ?? ( $dry_run ? 'Dry Run — nenhuma alteração será realizada.' : 'Item analisado.' );
	}

	private function merge_metrics( array &$target, array $source ): void {
		foreach ( $source as $key => $metric ) {
			if ( ! is_array( $metric ) ) { continue; }
			if ( ! isset( $target[ $key ] ) ) { $target[ $key ] = array( 'total_ms' => 0.0, 'count' => 0 ); }
			$target[ $key ]['total_ms'] = round( (float) $target[ $key ]['total_ms'] + (float) ( $metric['total_ms'] ?? 0 ), 3 );
			$target[ $key ]['count'] = absint( $target[ $key ]['count'] ?? 0 ) + absint( $metric['count'] ?? 0 );
		}
	}
}
