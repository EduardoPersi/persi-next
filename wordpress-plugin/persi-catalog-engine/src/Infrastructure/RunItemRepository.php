<?php

namespace Persi\CatalogEngine\Infrastructure;

defined( 'ABSPATH' ) || exit;

final class RunItemRepository {
	public function add( int $run_id, array $items, array $modules = array( 'gtin' ) ): bool {
		global $wpdb;
		$table = $wpdb->prefix . 'persi_catalog_run_items';
		$default_modules = array_values( array_intersect( array( 'gtin', 'attributes' ), $modules ) );
		if ( ! $items || ! $default_modules ) { return false; }
		$placeholders = array();
		$values = array();
		foreach ( $items as $item ) {
			$product_id = absint( $item['product_id'] ?? 0 );
			if ( ! $product_id ) { continue; }
			$item_modules = isset( $item['modules'] ) && is_array( $item['modules'] ) ? array_values( array_intersect( array( 'gtin', 'attributes' ), $item['modules'] ) ) : $default_modules;
			$modules_value = implode( ',', $item_modules );
			if ( '' === $modules_value ) { continue; }
			$placeholders[] = '(%d,%d,%d,%s,%s)';
			array_push( $values, $run_id, $product_id, absint( $item['parent_product_id'] ?? 0 ), 'variation' === ( $item['target_type'] ?? '' ) ? 'variation' : 'product', $modules_value );
		}
		if ( ! $placeholders ) { return false; }
		$sql = "INSERT INTO {$table} (run_id,product_id,parent_product_id,target_type,modules) VALUES " . implode( ',', $placeholders );
		return false !== $wpdb->query( $wpdb->prepare( $sql, ...$values ) );
	}
}
