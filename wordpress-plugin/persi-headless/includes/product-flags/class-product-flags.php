<?php

defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Product_Flags {
	const FREE_SHIPPING_CLASS = 'frete-gratis';

	public function register() {
		add_action( 'woocommerce_blocks_loaded', array( $this, 'extend_store_api' ) );
	}

	public function extend_store_api() {
		if ( ! function_exists( 'woocommerce_store_api_register_endpoint_data' ) ) return;
		$schema = array(
			'namespace'       => 'persi',
			'data_callback'   => array( $this, 'product_data' ),
			'schema_callback' => array( $this, 'product_schema' ),
			'schema_type'     => ARRAY_A,
		);
		woocommerce_store_api_register_endpoint_data( array_merge( $schema, array(
			'endpoint' => Automattic\WooCommerce\StoreApi\Schemas\V1\ProductSchema::IDENTIFIER,
		) ) );
		woocommerce_store_api_register_endpoint_data( array_merge( $schema, array(
			'endpoint' => Automattic\WooCommerce\StoreApi\Schemas\V1\CartItemSchema::IDENTIFIER,
		) ) );
	}

	public function product_data( $product ) {
		if ( is_array( $product ) ) {
			$product = isset( $product['data'] ) && $product['data'] instanceof WC_Product
				? $product['data']
				: wc_get_product( absint( $product['variation_id'] ?? $product['product_id'] ?? 0 ) );
		}
		return array( 'free_shipping' => $product instanceof WC_Product && self::FREE_SHIPPING_CLASS === $product->get_shipping_class() );
	}

	public function product_schema() {
		return array( 'free_shipping' => array(
			'description' => __( 'Indica a classe oficial de frete grátis do WooCommerce.', 'persi-headless' ),
			'type' => 'boolean', 'readonly' => true,
		) );
	}
}
