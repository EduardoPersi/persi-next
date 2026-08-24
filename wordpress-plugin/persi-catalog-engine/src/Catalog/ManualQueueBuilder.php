<?php

namespace Persi\CatalogEngine\Catalog;

defined( 'ABSPATH' ) || exit;

final class ManualQueueBuilder {
	public function build( array $selected_ids, array $modules ) {
		$ids = array_slice( array_values( array_unique( array_filter( array_map( 'absint', $selected_ids ) ) ) ), 0, 3100 );
		$modules = array_values( array_intersect( array( 'gtin', 'attributes' ), $modules ) );
		if ( ! $ids ) { return new \WP_Error( 'selection_required', 'Selecione pelo menos um produto.' ); }
		$targets = array();
		foreach ( $ids as $id ) {
			$post_type = get_post_type( $id );
			if ( ! in_array( $post_type, array( 'product', 'product_variation' ), true ) || ! in_array( get_post_status( $id ), array( 'publish', 'private' ), true ) ) { continue; }
			$product = wc_get_product( $id );
			if ( ! $product ) { continue; }
			$parent_id = $product->get_parent_id();
			$parent = $parent_id ? wc_get_product( $parent_id ) : $product;
			if ( in_array( 'attributes', $modules, true ) && $parent ) {
				$this->add_target( $targets, $parent, array( 'attributes' ) );
			}
			if ( ! in_array( 'gtin', $modules, true ) ) { continue; }
			if ( $product->is_type( 'variable' ) ) {
				foreach ( $product->get_children() as $child_id ) {
					$variation = wc_get_product( $child_id );
					if ( $variation && '' !== trim( (string) $variation->get_sku() ) ) { $this->add_target( $targets, $variation, array( 'gtin' ) ); }
				}
			} elseif ( '' !== trim( (string) $product->get_sku() ) ) {
				$this->add_target( $targets, $product, array( 'gtin' ) );
			}
		}
		if ( ! $targets ) { return new \WP_Error( 'selection_has_no_targets', 'A seleção não possui alvos válidos para os módulos escolhidos.' ); }
		ksort( $targets, SORT_NUMERIC );
		return array_values( $targets );
	}

	private function add_target( array &$targets, \WC_Product $product, array $modules ): void {
		$id = $product->get_id();
		if ( ! isset( $targets[ $id ] ) ) {
			$targets[ $id ] = array( 'product_id' => $id, 'parent_product_id' => $product->get_parent_id(), 'target_type' => $product->is_type( 'variation' ) ? 'variation' : 'product', 'modules' => array() );
		}
		$targets[ $id ]['modules'] = array_values( array_unique( array_merge( $targets[ $id ]['modules'], $modules ) ) );
	}
}
