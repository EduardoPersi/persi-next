<?php

namespace Persi\CatalogEngine\Infrastructure;

use Persi\CatalogEngine\Support\Statuses;

defined( 'ABSPATH' ) || exit;

final class AuditRepository {
	public function record( int $run_id, \WC_Product $product, array $result ): void {
		global $wpdb;
		$status = (string) ( $result['status'] ?? Statuses::SKIPPED );
		if ( ! in_array( $status, Statuses::all(), true ) ) {
			$status = Statuses::SKIPPED;
		}

		$wpdb->insert(
			$wpdb->prefix . 'persi_catalog_logs',
			array(
				'run_id'          => $run_id,
				'product_id'      => $product->get_id(),
				'product_name'    => wp_strip_all_tags( $product->get_name() ),
				'sku'             => (string) $product->get_sku(),
				'status'          => $status,
				'field_name'      => 'global_unique_id',
				'source'          => 'Olist ERP',
				'old_value'       => (string) ( $result['old_value'] ?? '' ),
				'new_value'       => (string) ( $result['new_value'] ?? '' ),
				'olist_product_id' => empty( $result['olist_product_id'] ) ? null : absint( $result['olist_product_id'] ),
				'details'         => isset( $result['details'] ) ? sanitize_text_field( (string) $result['details'] ) : null,
				'created_at'      => current_time( 'mysql', true ),
			)
		);
	}

	public function for_run( int $run_id, int $limit = 100 ): array {
		global $wpdb;
		return $wpdb->get_results( $wpdb->prepare( 'SELECT * FROM ' . $wpdb->prefix . 'persi_catalog_logs WHERE run_id=%d ORDER BY id ASC LIMIT %d', $run_id, min( 500, max( 1, $limit ) ) ) );
	}
}
