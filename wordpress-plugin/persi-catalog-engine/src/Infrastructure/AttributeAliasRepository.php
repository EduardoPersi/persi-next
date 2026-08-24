<?php
namespace Persi\CatalogEngine\Infrastructure;
defined( 'ABSPATH' ) || exit;
final class AttributeAliasRepository {
	public function suggest( string $concept, string $source, string $canonical, string $term = '' ): void {
		global $wpdb; $table = $wpdb->prefix . 'persi_catalog_attribute_aliases'; $now = current_time( 'mysql', true );
		$wpdb->query( $wpdb->prepare( "INSERT INTO {$table} (concept,source_value,canonical_value,target_term,status,created_at,updated_at) VALUES (%s,%s,%s,%s,'pending',%s,%s) ON DUPLICATE KEY UPDATE canonical_value=VALUES(canonical_value),target_term=VALUES(target_term),updated_at=VALUES(updated_at)", sanitize_key( $concept ), sanitize_text_field( $source ), sanitize_text_field( $canonical ), sanitize_text_field( $term ), $now, $now ) );
	}
	public function approved( string $concept, string $source ): ?object { global $wpdb; return $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . $wpdb->prefix . "persi_catalog_attribute_aliases WHERE concept=%s AND source_value=%s AND status='approved' LIMIT 1", sanitize_key( $concept ), sanitize_text_field( $source ) ) ) ?: null; }
}
