<?php

namespace Persi\CatalogEngine\Admin;

defined( 'ABSPATH' ) || exit;

final class ProductSearch {
	public function search( string $query, int $page = 1, int $category_id = 0, int $brand_id = 0 ): array {
		global $wpdb;
		$query = trim( sanitize_text_field( $query ) );
		if ( function_exists( 'mb_strlen' ) ? mb_strlen( $query ) < 2 : strlen( $query ) < 2 ) { return array(); }
		$page = max( 1, $page ); $limit = 20; $offset = ( $page - 1 ) * $limit;
		$like = '%' . $wpdb->esc_like( $query ) . '%';
		$lookup = $wpdb->prefix . 'wc_product_meta_lookup';
		$filters = '';
		$args = array( $like, $like );
		if ( $category_id ) { $filters .= " AND EXISTS (SELECT 1 FROM {$wpdb->term_relationships} tr JOIN {$wpdb->term_taxonomy} tt ON tt.term_taxonomy_id=tr.term_taxonomy_id WHERE tr.object_id=COALESCE(NULLIF(p.post_parent,0),p.ID) AND tt.taxonomy='product_cat' AND tt.term_id=%d)"; $args[] = $category_id; }
		if ( $brand_id && taxonomy_exists( 'product_brand' ) ) { $filters .= " AND EXISTS (SELECT 1 FROM {$wpdb->term_relationships} br JOIN {$wpdb->term_taxonomy} bt ON bt.term_taxonomy_id=br.term_taxonomy_id WHERE br.object_id=COALESCE(NULLIF(p.post_parent,0),p.ID) AND bt.taxonomy='product_brand' AND bt.term_id=%d)"; $args[] = $brand_id; }
		$args[] = $limit; $args[] = $offset;
		$sql = $wpdb->prepare( "SELECT p.ID FROM {$wpdb->posts} p LEFT JOIN {$lookup} l ON l.product_id=p.ID WHERE p.post_type IN ('product','product_variation') AND p.post_status IN ('publish','private') AND (p.post_title LIKE %s OR l.sku LIKE %s) {$filters} ORDER BY (l.sku=%s) DESC,p.post_title ASC LIMIT %d OFFSET %d", ...array_merge( array_slice( $args, 0, 2 ), array_slice( $args, 2, -2 ), array( $query ), array_slice( $args, -2 ) ) );
		$results = array();
		foreach ( array_map( 'absint', $wpdb->get_col( $sql ) ) as $id ) {
			$product = wc_get_product( $id ); if ( ! $product ) { continue; }
			$brand = wp_get_post_terms( $product->get_parent_id() ?: $id, 'product_brand', array( 'fields' => 'names' ) );
			$results[] = array( 'id' => $id, 'name' => wp_strip_all_tags( $product->get_name() ), 'sku' => (string) $product->get_sku(), 'type' => $product->is_type( 'variation' ) ? 'Variação' : ( $product->is_type( 'variable' ) ? 'Produto variável' : 'Produto simples' ), 'gtin' => (string) $product->get_global_unique_id(), 'brand' => is_wp_error( $brand ) || ! $brand ? '' : implode( ', ', $brand ) );
		}
		return $results;
	}
}
