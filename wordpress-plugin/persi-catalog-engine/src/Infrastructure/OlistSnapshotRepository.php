<?php

namespace Persi\CatalogEngine\Infrastructure;

use Persi\CatalogEngine\Api\Configuration;

defined( 'ABSPATH' ) || exit;

final class OlistSnapshotRepository {
	public function by_sku( string $sku ): ?array { return $this->find( 'sku', $sku ); }
	public function by_id( int $olist_id ): ?array { return $this->find( 'olist_product_id', $olist_id ); }

	public function save( string $sku, int $olist_id, array $snapshot ): bool {
		global $wpdb;
		if ( '' === $sku || $olist_id < 1 ) { return false; }
		$now = current_time( 'mysql', true );
		$expires = gmdate( 'Y-m-d H:i:s', time() + ( new Configuration() )->cache_ttl_seconds() );
		return false !== $wpdb->replace( $wpdb->prefix . 'persi_catalog_olist_cache', array(
			'sku' => mb_substr( $sku, 0, 191 ), 'olist_product_id' => $olist_id, 'snapshot' => wp_json_encode( $snapshot ),
			'fetched_at' => $now, 'expires_at' => $expires,
		) );
	}

	private function find( string $column, $value ): ?array {
		global $wpdb;
		$table = $wpdb->prefix . 'persi_catalog_olist_cache';
		$sql = 'sku' === $column
			? $wpdb->prepare( "SELECT snapshot FROM {$table} WHERE sku=%s AND expires_at>%s LIMIT 1", (string) $value, current_time( 'mysql', true ) )
			: $wpdb->prepare( "SELECT snapshot FROM {$table} WHERE olist_product_id=%d AND expires_at>%s ORDER BY fetched_at DESC LIMIT 1", absint( $value ), current_time( 'mysql', true ) );
		$decoded = json_decode( (string) $wpdb->get_var( $sql ), true );
		return is_array( $decoded ) ? $decoded : null;
	}
}
