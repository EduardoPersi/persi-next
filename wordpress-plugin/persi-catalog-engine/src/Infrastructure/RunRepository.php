<?php

namespace Persi\CatalogEngine\Infrastructure;

use Persi\CatalogEngine\Support\Performance;

defined( 'ABSPATH' ) || exit;

final class RunRepository {
	public function create( string $mode, string $scope, int $limit, int $user_id, array $modules = array( 'gtin' ) ): int {
		global $wpdb;
		$wpdb->insert(
			$wpdb->prefix . 'persi_catalog_runs',
			array(
				'mode'            => 'sync' === $mode ? 'sync' : 'dry-run',
				'modules'         => implode( ',', array_values( array_intersect( array( 'gtin', 'attributes' ), $modules ) ) ),
				'scope'           => in_array( $scope, array( 'all', 'missing-gtin', 'failures', 'selected' ), true ) ? $scope : 'missing-unchecked',
				'status'          => 'pending',
				'requested_limit' => min( 3100, max( 1, $limit ) ),
				'counters'        => wp_json_encode( array() ),
				'created_by'      => $user_id,
				'created_at'      => current_time( 'mysql', true ),
				'updated_at'      => current_time( 'mysql', true ),
			)
		);
		return absint( $wpdb->insert_id );
	}

	public function get( int $run_id ): ?object {
		global $wpdb;
		return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . $wpdb->prefix . 'persi_catalog_runs WHERE id=%d', $run_id ) ) ?: null;
	}

	public function latest(): ?object {
		global $wpdb;
		return $wpdb->get_row( 'SELECT * FROM ' . $wpdb->prefix . 'persi_catalog_runs ORDER BY id DESC LIMIT 1' ) ?: null;
	}

	public function active(): ?object {
		global $wpdb;
		return $wpdb->get_row( "SELECT * FROM {$wpdb->prefix}persi_catalog_runs WHERE status IN ('pending','running') ORDER BY id DESC LIMIT 1" ) ?: null;
	}

	public function stale_preparation( int $seconds = 120 ): ?object {
		global $wpdb;
		$cutoff = gmdate( 'Y-m-d H:i:s', time() - max( 60, $seconds ) );
		return $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}persi_catalog_runs WHERE status='pending' AND current_stage='QUEUE_PREPARING' AND updated_at<%s ORDER BY id ASC LIMIT 1", $cutoff ) ) ?: null;
	}

	public function queue_ready( int $run_id, int $total, array $metrics = array() ): bool {
		global $wpdb;
		$data = array( 'total_items' => $total, 'current_stage' => 'QUEUE_READY', 'current_message' => $total > 0 ? 'Fila preparada.' : 'Nenhum produto elegível encontrado.', 'updated_at' => current_time( 'mysql', true ) );
		if ( $metrics ) { $data['performance_metrics'] = wp_json_encode( $metrics ); }
		return false !== $wpdb->update( $wpdb->prefix . 'persi_catalog_runs', $data, array( 'id' => $run_id ) );
	}

	public function metrics( int $run_id, array $metrics ): void {
		if ( ! $metrics ) { return; }
		global $wpdb;
		$wpdb->update( $wpdb->prefix . 'persi_catalog_runs', array( 'performance_metrics' => wp_json_encode( $metrics ), 'updated_at' => current_time( 'mysql', true ) ), array( 'id' => $run_id ) );
	}

	public function current( int $run_id, \WC_Product $product, string $stage, string $message ): void {
		global $wpdb;
		$wpdb->update( $wpdb->prefix . 'persi_catalog_runs', array( 'current_product_id' => $product->get_id(), 'current_product_name' => wp_strip_all_tags( $product->get_name() ), 'current_sku' => (string) $product->get_sku(), 'current_stage' => sanitize_text_field( $stage ), 'current_message' => sanitize_text_field( $message ), 'updated_at' => current_time( 'mysql', true ) ), array( 'id' => $run_id ) );
	}

	public function mark_running( int $run_id ): void {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->prefix}persi_catalog_runs SET status='running',started_at=COALESCE(started_at,%s) WHERE id=%d AND status IN ('pending','running')", current_time( 'mysql', true ), $run_id ) );
	}

	public function advance( int $run_id, int $cursor, int $processed, array $counters, array $metrics = array(), ?\WC_Product $product = null, string $stage = '', string $message = '' ): void {
		global $wpdb;
		$data = array( 'cursor_id' => $cursor, 'processed' => $processed, 'counters' => wp_json_encode( $counters ), 'updated_at' => current_time( 'mysql', true ) );
		if ( $metrics ) { $data['performance_metrics'] = wp_json_encode( $metrics ); }
		if ( $product ) { $data['current_product_id'] = $product->get_id(); $data['current_product_name'] = wp_strip_all_tags( $product->get_name() ); $data['current_sku'] = (string) $product->get_sku(); }
		if ( $stage ) { $data['current_stage'] = sanitize_text_field( $stage ); }
		if ( $message ) { $data['current_message'] = sanitize_text_field( $message ); }
		$wpdb->update(
			$wpdb->prefix . 'persi_catalog_runs',
			$data,
			array( 'id' => $run_id, 'status' => 'running' )
		);
	}

	public function fail( int $run_id, string $stage, string $code, string $message ): void {
		global $wpdb;
		$wpdb->update( $wpdb->prefix . 'persi_catalog_runs', array(
			'status' => 'failed', 'current_stage' => 'PREPARATION_FAILED', 'current_message' => sanitize_text_field( $message ),
			'failure_stage' => sanitize_text_field( $stage ), 'failure_code' => sanitize_key( $code ), 'failure_message' => sanitize_text_field( $message ),
			'finished_at' => current_time( 'mysql', true ), 'updated_at' => current_time( 'mysql', true ),
		), array( 'id' => $run_id ) );
	}

	public function finish( int $run_id, string $status = 'completed' ): void {
		global $wpdb;
		$allowed = in_array( $status, array( 'completed', 'partial_success', 'failed' ), true ) ? $status : 'failed';
		$data = array( 'status' => $allowed, 'current_stage' => 'completed' === $allowed ? 'COMPLETED' : ( 'partial_success' === $allowed ? 'PARTIAL_SUCCESS' : 'API_ERROR' ), 'current_message' => 'completed' === $allowed ? 'Processamento concluído.' : ( 'partial_success' === $allowed ? 'Atributos locais concluídos; GTIN teve falhas no Olist.' : 'Processamento interrompido.' ), 'finished_at' => current_time( 'mysql', true ), 'updated_at' => current_time( 'mysql', true ) );
		if ( Performance::enabled() ) {
			$run = $this->get( $run_id ); $metrics = $run ? json_decode( (string) $run->performance_metrics, true ) : array(); $metrics = is_array( $metrics ) ? $metrics : array();
			$created = $run ? strtotime( (string) $run->created_at . ' UTC' ) : false;
			if ( $created ) { Performance::add( $metrics, 'TOTAL_RUN_TIME', max( 0, ( microtime( true ) - $created ) * 1000 ) ); }
			$data['performance_metrics'] = wp_json_encode( $metrics );
		}
		$wpdb->update( $wpdb->prefix . 'persi_catalog_runs', $data, array( 'id' => $run_id ) );
	}

	public function cancel( int $run_id ): bool {
		global $wpdb;
		return false !== $wpdb->query( $wpdb->prepare(
			"UPDATE {$wpdb->prefix}persi_catalog_runs SET status='cancelled',current_stage='CANCELLED',current_message='Processamento cancelado pelo administrador.',finished_at=%s,updated_at=%s WHERE id=%d AND status IN ('pending','running')",
			current_time( 'mysql', true ), current_time( 'mysql', true ), $run_id
		) );
	}

	public function is_cancelled( int $run_id ): bool {
		global $wpdb;
		return 'cancelled' === $wpdb->get_var( $wpdb->prepare( "SELECT status FROM {$wpdb->prefix}persi_catalog_runs WHERE id=%d", $run_id ) );
	}
}
