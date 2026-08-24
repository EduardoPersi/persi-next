<?php

namespace Persi\CatalogEngine\Admin;

use Persi\CatalogEngine\Api\Configuration;
use Persi\CatalogEngine\Api\TokenStore;
use Persi\CatalogEngine\Catalog\BatchProcessor;
use Persi\CatalogEngine\Catalog\ManualQueueBuilder;
use Persi\CatalogEngine\Infrastructure\AuditRepository;
use Persi\CatalogEngine\Infrastructure\RunRepository;
use Persi\CatalogEngine\Support\Lock;

defined( 'ABSPATH' ) || exit;

final class AdminPage {
	private BatchProcessor $processor;
	private Configuration $configuration;

	public function __construct( BatchProcessor $processor ) {
		$this->processor     = $processor;
		$this->configuration = new Configuration();
	}

	public function register(): void {
		add_action( 'admin_menu', array( $this, 'menu' ), 60 );
		add_action( 'admin_post_persi_catalog_start', array( $this, 'start' ) );
		add_action( 'admin_post_persi_catalog_olist_connect', array( $this, 'connect' ) );
		add_action( 'admin_post_persi_catalog_olist_callback', array( $this, 'callback' ) );
		add_action( 'admin_post_persi_catalog_olist_disconnect', array( $this, 'disconnect' ) );
		add_action( 'wp_ajax_persi_catalog_progress', array( $this, 'progress' ) );
		add_action( 'wp_ajax_persi_catalog_cancel', array( $this, 'cancel' ) );
		add_action( 'wp_ajax_persi_catalog_kick_worker', array( $this, 'kick_worker' ) );
		add_action( 'wp_ajax_persi_catalog_product_search', array( $this, 'product_search' ) );
		add_action( 'wp_ajax_persi_catalog_selection_preview', array( $this, 'selection_preview' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'assets' ) );
	}

	public function menu(): void {
		add_submenu_page(
			'woocommerce',
			__( 'Persi Catálogo', 'persi-catalog-engine' ),
			__( 'Persi Catálogo', 'persi-catalog-engine' ),
			'manage_woocommerce',
			'persi-catalog-engine',
			array( $this, 'render' )
		);
	}

	public function render(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Acesso negado.', 'persi-catalog-engine' ) );
		}

		$run_repository = new RunRepository();
		$stale = $run_repository->stale_preparation();
		if ( $stale ) { $run_repository->fail( absint( $stale->id ), 'QUEUE_PREPARING', 'preparation_timeout', 'A preparação não foi concluída em até 2 minutos.' ); ( new Lock() )->release( absint( $stale->id ) ); }
		$run    = $run_repository->latest();
		$logs   = $run ? ( new AuditRepository() )->for_run( (int) $run->id, 100 ) : array();
		$tokens = ( new TokenStore() )->get();
		$active_id  = ( new Lock() )->active_run_id();
		$active_run = $active_id ? ( new RunRepository() )->get( $active_id ) : null;
		$product_categories = get_terms( array( 'taxonomy' => 'product_cat', 'hide_empty' => true, 'number' => 200, 'orderby' => 'name' ) );
		$product_brands = taxonomy_exists( 'product_brand' ) ? get_terms( array( 'taxonomy' => 'product_brand', 'hide_empty' => true, 'number' => 200, 'orderby' => 'name' ) ) : array();
		$product_categories = is_wp_error( $product_categories ) ? array() : $product_categories;
		$product_brands = is_wp_error( $product_brands ) ? array() : $product_brands;
		include PERSI_CATALOG_ENGINE_PATH . 'templates/admin/catalog.php';
	}

	public function start(): void {
		$this->authorize( 'persi_catalog_start' );
		$mode  = isset( $_POST['mode'] ) && 'sync' === sanitize_key( wp_unslash( $_POST['mode'] ) ) ? 'sync' : 'dry-run';
		$selection_mode = isset( $_POST['selection_mode'] ) ? sanitize_key( wp_unslash( $_POST['selection_mode'] ) ) : 'automatic';
		$scope = 'manual' === $selection_mode ? 'selected' : ( isset( $_POST['scope'] ) ? sanitize_key( wp_unslash( $_POST['scope'] ) ) : 'missing-unchecked' );
		$scope = in_array( $scope, array( 'missing-unchecked', 'missing-gtin', 'failures', 'all', 'selected' ), true ) ? $scope : 'missing-unchecked';
		$limit = min( 3100, max( 1, absint( $_POST['limit'] ?? 10 ) ) );
		$posted_modules = isset( $_POST['modules'] ) && is_array( $_POST['modules'] ) ? array_map( 'sanitize_key', wp_unslash( $_POST['modules'] ) ) : array();
		$modules = array_values( array_intersect( array( 'gtin', 'attributes' ), $posted_modules ) );
		if ( ! $modules ) {
			$this->redirect( 'module_required' );
		}
		if ( 'sync' === $mode && in_array( 'attributes', $modules, true ) ) { $this->redirect( 'attributes_dry_run_only' ); }
		if ( 'selected' !== $scope && in_array( 'attributes', $modules, true ) && ! in_array( 'gtin', $modules, true ) ) { $scope = 'all'; }
		if ( 'sync' === $mode && 1 !== absint( $_POST['confirm_sync'] ?? 0 ) ) {
			$this->redirect( 'confirmation_required' );
		}
		$selected_ids = isset( $_POST['selected_product_ids'] ) && is_array( $_POST['selected_product_ids'] ) ? array_values( array_unique( array_map( 'absint', wp_unslash( $_POST['selected_product_ids'] ) ) ) ) : array();
		if ( 'selected' === $scope && $selected_ids ) { $limit = min( 3100, count( $selected_ids ) ); }
		$result = $this->processor->start( $mode, $scope, $limit, get_current_user_id(), $modules, $selected_ids );
		if ( is_wp_error( $result ) ) {
			$data = $result->get_error_data();
			$this->redirect( $result->get_error_code(), is_array( $data ) ? absint( $data['run_id'] ?? 0 ) : 0 );
		}
		$this->redirect( 'scheduled', absint( $result ) );
	}

	public function assets( string $hook ): void {
		if ( 'woocommerce_page_persi-catalog-engine' !== $hook ) { return; }
		wp_enqueue_style( 'persi-catalog-admin', plugins_url( 'assets/admin.css', PERSI_CATALOG_ENGINE_FILE ), array(), PERSI_CATALOG_ENGINE_VERSION );
		wp_enqueue_script( 'persi-catalog-admin', plugins_url( 'assets/admin.js', PERSI_CATALOG_ENGINE_FILE ), array(), PERSI_CATALOG_ENGINE_VERSION, true );
		wp_localize_script( 'persi-catalog-admin', 'persiCatalogProgress', array(
			'ajaxUrl' => admin_url( 'admin-ajax.php' ), 'nonce' => wp_create_nonce( 'persi_catalog_progress' ),
			'cancelNonce' => wp_create_nonce( 'persi_catalog_cancel' ),
			'selectionNonce' => wp_create_nonce( 'persi_catalog_product_selection' ),
			'runId' => absint( $_GET['run_id'] ?? 0 ), 'pollInterval' => 2000,
		) );
	}

	public function product_search(): void {
		$this->authorize_ajax_selection();
		$query = isset( $_GET['query'] ) ? sanitize_text_field( wp_unslash( $_GET['query'] ) ) : '';
		$results = ( new ProductSearch() )->search( $query, absint( $_GET['page'] ?? 1 ), absint( $_GET['category_id'] ?? 0 ), absint( $_GET['brand_id'] ?? 0 ) );
		wp_send_json_success( array( 'results' => $results, 'hasMore' => 20 === count( $results ) ) );
	}

	public function selection_preview(): void {
		$this->authorize_ajax_selection();
		$ids = isset( $_POST['ids'] ) && is_array( $_POST['ids'] ) ? array_map( 'absint', wp_unslash( $_POST['ids'] ) ) : array();
		$posted = isset( $_POST['modules'] ) && is_array( $_POST['modules'] ) ? array_map( 'sanitize_key', wp_unslash( $_POST['modules'] ) ) : array();
		$modules = array_values( array_intersect( array( 'gtin', 'attributes' ), $posted ) );
		$items = ( new ManualQueueBuilder() )->build( $ids, $modules );
		if ( is_wp_error( $items ) ) { wp_send_json_error( array( 'message' => $items->get_error_message() ), 400 ); }
		$gtin = 0; $attributes = 0;
		foreach ( $items as $item ) { $gtin += in_array( 'gtin', $item['modules'], true ) ? 1 : 0; $attributes += in_array( 'attributes', $item['modules'], true ) ? 1 : 0; }
		wp_send_json_success( array( 'queueTotal' => count( $items ), 'gtinTargets' => $gtin, 'attributeTargets' => $attributes ) );
	}

	private function authorize_ajax_selection(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_send_json_error( array( 'message' => 'Acesso negado.' ), 403 ); }
		check_ajax_referer( 'persi_catalog_product_selection', 'nonce' );
	}

	public function progress(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_send_json_error( array( 'message' => 'Acesso negado.' ), 403 ); }
		check_ajax_referer( 'persi_catalog_progress', 'nonce' );
		$run = ( new RunRepository() )->get( absint( $_GET['run_id'] ?? 0 ) );
		if ( ! $run ) { wp_send_json_error( array( 'message' => 'Execução não encontrada.' ), 404 ); }
		$counters = json_decode( (string) $run->counters, true );
		$payload = array(
			'id' => absint( $run->id ), 'mode' => (string) $run->mode, 'modules' => (string) $run->modules, 'status' => (string) $run->status,
			'total' => absint( $run->total_items ), 'requested' => absint( $run->requested_limit ), 'processed' => absint( $run->processed ), 'productName' => (string) $run->current_product_name,
			'sku' => (string) $run->current_sku, 'stage' => (string) $run->current_stage, 'message' => (string) $run->current_message,
			'counters' => is_array( $counters ) ? $counters : array(), 'startedAt' => (string) $run->started_at, 'finishedAt' => (string) $run->finished_at,
			'failureStage' => (string) ( $run->failure_stage ?? '' ), 'failureCode' => (string) ( $run->failure_code ?? '' ), 'failureMessage' => (string) ( $run->failure_message ?? '' ),
		);
		if ( \Persi\CatalogEngine\Support\Performance::enabled() ) { $payload['performance'] = json_decode( (string) ( $run->performance_metrics ?? '' ), true ) ?: array(); }
		wp_send_json_success( $payload );
	}

	public function cancel(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_send_json_error( array( 'message' => 'Acesso negado.' ), 403 ); }
		check_ajax_referer( 'persi_catalog_cancel', 'nonce' );
		$run_id = absint( $_POST['run_id'] ?? 0 );
		$repository = new RunRepository();
		$run = $repository->get( $run_id );
		if ( ! $run ) { wp_send_json_error( array( 'message' => 'Execução não encontrada.' ), 404 ); }
		if ( ! in_array( $run->status, array( 'pending', 'running' ), true ) ) { wp_send_json_error( array( 'message' => 'Esta execução já foi encerrada.' ), 409 ); }
		if ( ! $repository->cancel( $run_id ) ) { wp_send_json_error( array( 'message' => 'Não foi possível cancelar a execução.' ), 500 ); }
		if ( function_exists( 'as_unschedule_all_actions' ) ) { as_unschedule_all_actions( BatchProcessor::ACTION, array( $run_id ), BatchProcessor::GROUP ); }
		( new Lock() )->release( $run_id );
		wp_send_json_success( array( 'message' => 'Processamento cancelado.' ) );
	}

	public function kick_worker(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_send_json_error( array( 'message' => 'Acesso negado.' ), 403 ); }
		check_ajax_referer( 'persi_catalog_progress', 'nonce' );
		$run_id = absint( $_POST['run_id'] ?? 0 );
		$run = ( new RunRepository() )->get( $run_id );
		if ( ! $run || ! in_array( $run->status, array( 'pending', 'running' ), true ) ) { wp_send_json_error( array( 'message' => 'Execução não está disponível para processamento.' ), 409 ); }
		$this->processor->process( $run_id );
		wp_send_json_success( array( 'message' => 'Worker acionado.' ) );
	}

	public function connect(): void {
		$this->authorize( 'persi_catalog_olist_connect' );
		if ( ! $this->configuration->configured() ) {
			$this->redirect( 'credentials_missing' );
		}
		$state = wp_generate_password( 48, false, false );
		set_transient( 'persi_catalog_oauth_' . get_current_user_id(), hash( 'sha256', $state ), 10 * MINUTE_IN_SECONDS );
		$url = add_query_arg(
			array(
				'client_id'     => $this->configuration->client_id(),
				'redirect_uri'  => $this->configuration->redirect_uri(),
				'scope'         => 'openid',
				'response_type' => 'code',
				'state'         => $state,
			),
			'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth'
		);
		// Host fixo e documentado do Olist; não há entrada do usuário no destino.
		wp_redirect( $url );
		exit;
	}

	public function callback(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Acesso negado.', 'persi-catalog-engine' ) );
		}
		$state    = isset( $_GET['state'] ) ? sanitize_text_field( wp_unslash( $_GET['state'] ) ) : '';
		$expected = get_transient( 'persi_catalog_oauth_' . get_current_user_id() );
		delete_transient( 'persi_catalog_oauth_' . get_current_user_id() );
		if ( ! is_string( $expected ) || ! hash_equals( $expected, hash( 'sha256', $state ) ) ) {
			$this->redirect( 'invalid_oauth_state' );
		}
		$code = isset( $_GET['code'] ) ? sanitize_text_field( wp_unslash( $_GET['code'] ) ) : '';
		if ( '' === $code ) {
			$this->redirect( 'authorization_denied' );
		}
		$response = wp_safe_remote_post(
			Configuration::TOKEN_URL,
			array(
				'timeout' => 20,
				'body'    => array(
					'grant_type'    => 'authorization_code',
					'client_id'     => $this->configuration->client_id(),
					'client_secret' => $this->configuration->client_secret(),
					'redirect_uri'  => $this->configuration->redirect_uri(),
					'code'          => $code,
				),
			)
		);
		$body = is_wp_error( $response ) ? null : json_decode( wp_remote_retrieve_body( $response ), true );
		if ( 200 !== ( is_wp_error( $response ) ? 0 : wp_remote_retrieve_response_code( $response ) ) || ! is_array( $body ) || empty( $body['access_token'] ) || empty( $body['refresh_token'] ) ) {
			$this->redirect( 'token_exchange_failed' );
		}
		$saved = ( new TokenStore() )->save( (string) $body['access_token'], (string) $body['refresh_token'], absint( $body['expires_in'] ?? 14400 ) );
		$this->redirect( $saved ? 'connected' : 'token_storage_failed' );
	}

	public function disconnect(): void {
		$this->authorize( 'persi_catalog_olist_disconnect' );
		( new TokenStore() )->clear();
		$this->redirect( 'disconnected' );
	}

	private function authorize( string $action ): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Acesso negado.', 'persi-catalog-engine' ) );
		}
		check_admin_referer( $action );
	}

	private function redirect( string $notice, int $run_id = 0 ): void {
		$args = array( 'persi_notice' => sanitize_key( $notice ) );
		if ( $run_id ) { $args['run_id'] = $run_id; }
		wp_safe_redirect( add_query_arg( $args, admin_url( 'admin.php?page=persi-catalog-engine' ) ) );
		exit;
	}
}
