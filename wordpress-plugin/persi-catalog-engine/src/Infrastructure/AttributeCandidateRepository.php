<?php

namespace Persi\CatalogEngine\Infrastructure;

defined( 'ABSPATH' ) || exit;

final class AttributeCandidateRepository {
	public function has_product( int $run_id, int $product_id ): bool {
		global $wpdb;
		return (bool) $wpdb->get_var( $wpdb->prepare( 'SELECT 1 FROM ' . $wpdb->prefix . 'persi_catalog_attribute_candidates WHERE run_id=%d AND product_id=%d LIMIT 1', $run_id, $product_id ) );
	}

	public function record( int $run_id, \WC_Product $product, array $candidate ): void {
		global $wpdb;
		$wpdb->insert( $wpdb->prefix . 'persi_catalog_attribute_candidates', array(
			'run_id' => $run_id, 'product_id' => $product->get_id(), 'parent_product_id' => $product->get_parent_id(),
			'sku' => (string) $product->get_sku(), 'category_path' => (string) ( $candidate['category'] ?? '' ), 'family' => sanitize_key( $candidate['family'] ?? 'generic' ), 'module' => 'attributes',
			'attribute_key' => sanitize_key( $candidate['attribute_key'] ?? '' ), 'woo_taxonomy' => sanitize_key( $candidate['woo_taxonomy'] ?? '' ),
			'old_value' => sanitize_text_field( (string) ( $candidate['old_value'] ?? '' ) ), 'raw_value' => sanitize_text_field( (string) ( $candidate['raw_value'] ?? '' ) ),
			'normalized_value' => sanitize_text_field( (string) ( $candidate['normalized_value'] ?? '' ) ), 'display_value' => sanitize_text_field( (string) ( $candidate['display_value'] ?? $candidate['normalized_value'] ?? '' ) ), 'numeric_value' => is_numeric( $candidate['numeric_value'] ?? null ) ? (float) $candidate['numeric_value'] : null, 'unit' => sanitize_text_field( (string) ( $candidate['unit'] ?? '' ) ), 'unit_source' => sanitize_text_field( (string) ( $candidate['unit_source'] ?? '' ) ),
			'components' => empty( $candidate['components'] ) ? null : wp_json_encode( $candidate['components'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ), 'search_aliases' => empty( $candidate['search_aliases'] ) ? null : wp_json_encode( array_values( $candidate['search_aliases'] ), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ),
			'source' => sanitize_text_field( (string) ( $candidate['source'] ?? '' ) ), 'source_field' => sanitize_text_field( (string) ( $candidate['source_field'] ?? '' ) ), 'evidence' => sanitize_text_field( mb_substr( (string) ( $candidate['evidence'] ?? '' ), 0, 500 ) ),
			'existing_term' => sanitize_text_field( (string) ( $candidate['existing_term'] ?? '' ) ), 'rule_id' => sanitize_key( $candidate['rule_id'] ?? '' ), 'ruleset_version' => sanitize_text_field( (string) ( $candidate['ruleset_version'] ?? '' ) ),
			'confidence' => sanitize_text_field( (string) ( $candidate['confidence'] ?? 'LOW' ) ), 'status' => sanitize_text_field( (string) ( $candidate['status'] ?? 'ATTRIBUTE_SKIPPED' ) ),
			'created_at' => current_time( 'mysql', true ), 'updated_at' => current_time( 'mysql', true ),
		) );
	}

	public function for_run( int $run_id, int $limit = 500, array $filters = array() ): array {
		global $wpdb;
		$where = array( 'candidate.run_id=%d' ); $params = array( $run_id );
		foreach ( array( 'status', 'attribute_key', 'source', 'confidence', 'family' ) as $key ) { if ( ! empty( $filters[ $key ] ) ) { $where[] = "candidate.{$key}=%s"; $params[] = sanitize_text_field( $filters[ $key ] ); } }
		if ( ! empty( $filters['hide_synced'] ) ) { $where[] = "candidate.status<>'ATTRIBUTE_ALREADY_SYNCED'"; }
		if ( ! empty( $filters['hide_rejected'] ) ) { $where[] = "candidate.source<>'REJECTED_DISCOVERY'"; }
		$params[] = min( 1000, max( 1, $limit ) );
		return $wpdb->get_results( $wpdb->prepare( 'SELECT candidate.*,posts.post_title product_name FROM ' . $wpdb->prefix . 'persi_catalog_attribute_candidates candidate LEFT JOIN ' . $wpdb->posts . ' posts ON posts.ID=candidate.product_id WHERE ' . implode( ' AND ', $where ) . ' ORDER BY candidate.id ASC LIMIT %d', ...$params ) );
	}

	public function coverage( int $run_id ): array {
		global $wpdb;
		$rows = $wpdb->get_results( $wpdb->prepare( 'SELECT source,status,COUNT(*) total FROM ' . $wpdb->prefix . 'persi_catalog_attribute_candidates WHERE run_id=%d GROUP BY source,status', $run_id ) );
		$result = array();
		foreach ( $rows as $row ) { $result[ $row->source . ' / ' . $row->status ] = absint( $row->total ); }
		return $result;
	}

	public function summary( int $run_id ): array {
		global $wpdb; $table = $wpdb->prefix . 'persi_catalog_attribute_candidates';
		return array(
			'products' => absint( $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(DISTINCT product_id) FROM {$table} WHERE run_id=%d", $run_id ) ) ),
			'statuses' => $wpdb->get_results( $wpdb->prepare( "SELECT status,COUNT(*) total FROM {$table} WHERE run_id=%d GROUP BY status ORDER BY total DESC", $run_id ) ),
			'concepts' => $wpdb->get_results( $wpdb->prepare( "SELECT attribute_key,COUNT(*) total FROM {$table} WHERE run_id=%d GROUP BY attribute_key ORDER BY total DESC", $run_id ) ),
			'rules' => $wpdb->get_results( $wpdb->prepare( "SELECT source,rule_id,COUNT(*) total FROM {$table} WHERE run_id=%d GROUP BY source,rule_id ORDER BY total DESC", $run_id ) ),
		);
	}

	public function filter_values( int $run_id ): array {
		global $wpdb; $table = $wpdb->prefix . 'persi_catalog_attribute_candidates'; $result = array();
		foreach ( array( 'status', 'attribute_key', 'source', 'confidence', 'family' ) as $column ) { $result[ $column ] = $wpdb->get_col( $wpdb->prepare( "SELECT DISTINCT {$column} FROM {$table} WHERE run_id=%d AND {$column}<>'' ORDER BY {$column}", $run_id ) ); }
		return $result;
	}
}
