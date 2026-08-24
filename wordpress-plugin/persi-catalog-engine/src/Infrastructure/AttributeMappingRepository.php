<?php

namespace Persi\CatalogEngine\Infrastructure;

defined( 'ABSPATH' ) || exit;

final class AttributeMappingRepository {
	private array $cache = array();
	public function save( string $origin, int $category_id, string $attribute_key, string $taxonomy, string $normalizer, int $user_id, string $family = '' ): bool {
		global $wpdb;
		return false !== $wpdb->replace( $wpdb->prefix . 'persi_catalog_attribute_mappings', array(
			'origin_key' => $this->normalize_origin( $origin ), 'category_id' => $category_id, 'family' => sanitize_key( $family ), 'attribute_key' => sanitize_key( $attribute_key ),
			'woo_taxonomy' => sanitize_key( $taxonomy ), 'normalizer' => sanitize_key( $normalizer ), 'is_active' => 1, 'auto_write' => 0,
			'created_by' => $user_id, 'created_at' => current_time( 'mysql', true ),
		) );
	}

	public function all(): array { global $wpdb; return $wpdb->get_results( 'SELECT * FROM ' . $wpdb->prefix . 'persi_catalog_attribute_mappings ORDER BY origin_key,category_id' ); }

	public function resolve( string $origin, array $category_ids, string $family = '' ): ?object {
		global $wpdb;
		$origin = $this->normalize_origin( $origin ); $family = sanitize_key( $family );
		$cache_key = $origin . '|' . $family . '|' . implode( ',', array_map( 'absint', $category_ids ) ); if ( array_key_exists( $cache_key, $this->cache ) ) { return $this->cache[ $cache_key ]; }
		$ids = array_values( array_filter( array_map( 'absint', $category_ids ) ) );
		if ( $ids ) {
			$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
			$params = array_merge( array( $origin, $family ), $ids );
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$wpdb->prefix}persi_catalog_attribute_mappings WHERE origin_key=%s AND family IN (%s,'') AND category_id IN ({$placeholders}) AND is_active=1 ORDER BY (family=%s) DESC,category_id DESC LIMIT 1", ...array_merge( $params, array( $family ) ) ) );
			if ( $row ) { return $this->cache[ $cache_key ] = $row; }
		}
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . $wpdb->prefix . "persi_catalog_attribute_mappings WHERE origin_key=%s AND family IN (%s,'') AND category_id=0 AND is_active=1 ORDER BY (family=%s) DESC LIMIT 1", $origin, $family, $family ) ) ?: null; return $this->cache[ $cache_key ] = $row;
	}

	private function normalize_origin( string $origin ): string { return strtolower( remove_accents( trim( sanitize_text_field( $origin ) ) ) ); }
}
