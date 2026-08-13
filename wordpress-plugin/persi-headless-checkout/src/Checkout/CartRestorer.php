<?php

namespace Persi\HeadlessCheckout\Checkout;

defined( 'ABSPATH' ) || exit;

final class CartRestorer {
	private $product_resolver;

	public function __construct( ?callable $product_resolver = null ) {
		$this->product_resolver = $product_resolver;
	}

	public function initialize_woocommerce(): void {
		if ( ! function_exists( 'WC' ) || ! function_exists( 'wc_load_cart' ) ) {
			throw new CartRestoreException( 'woocommerce_unavailable' );
		}

		if ( null === WC()->session || null === WC()->customer || null === WC()->cart ) {
			wc_load_cart();
		}

		if ( null === WC()->session || null === WC()->customer || null === WC()->cart ) {
			throw new CartRestoreException( 'cart_initialization_failed' );
		}
	}

	public function prevalidate( array $items ): array {
		$validated = array();
		$seen      = array();

		foreach ( $items as $item ) {
			$product_id   = $item['productId'] ?? 0;
			$variation_id = $item['variationId'] ?? 0;
			$quantity     = $item['quantity'] ?? 0;

			if (
				! is_int( $product_id )
				|| $product_id < 1
				|| ! is_int( $variation_id )
				|| $variation_id < 0
				|| ! is_int( $quantity )
				|| $quantity < 1
				|| $quantity > 999
			) {
				throw new CartRestoreException( 'invalid_item' );
			}

			$item_key = $product_id . ':' . $variation_id;

			if ( isset( $seen[ $item_key ] ) ) {
				throw new CartRestoreException( 'duplicate_item' );
			}

			$seen[ $item_key ] = true;
			$parent            = $this->get_product( $product_id );

			if ( ! $parent ) {
				throw new CartRestoreException( 'product_not_found' );
			}

			if ( 'publish' !== $parent->get_status() ) {
				throw new CartRestoreException( 'product_not_published' );
			}

			if ( 0 === $variation_id ) {
				$validated_item = $this->validate_simple_product( $parent, $product_id, $quantity );
				$this->validate_cart_item_requirements( $validated_item );
				$validated[] = $validated_item;
				continue;
			}

			$validated_item = $this->validate_variation(
				$parent,
				$product_id,
				$variation_id,
				$quantity
			);
			$this->validate_cart_item_requirements( $validated_item );
			$validated[] = $validated_item;
		}

		return $validated;
	}

	public function snapshot_current_cart(): array {
		$snapshot = array();

		foreach ( WC()->cart->get_cart() as $cart_item ) {
			$cart_item_data = $cart_item;

			foreach (
				array(
					'key',
					'product_id',
					'variation_id',
					'quantity',
					'data',
					'data_hash',
					'line_tax_data',
					'line_subtotal',
					'line_subtotal_tax',
					'line_total',
					'line_tax',
				) as $reserved_key
			) {
				unset( $cart_item_data[ $reserved_key ] );
			}

			$snapshot[] = array(
				'product_id'    => (int) $cart_item['product_id'],
				'variation_id'  => (int) $cart_item['variation_id'],
				'quantity'      => (int) $cart_item['quantity'],
				'variation'     => is_array( $cart_item['variation'] ?? null ) ? $cart_item['variation'] : array(),
				'cart_item_data' => $cart_item_data,
			);
		}

		return $snapshot;
	}

	public function restore_validated_items(
		array $items,
		array $billing_address,
		array $shipping_address,
		string $owner_token
	): void {
		WC()->cart->empty_cart();

		try {
			foreach ( $items as $item ) {
				$cart_item_key = WC()->cart->add_to_cart(
					$item['product_id'],
					$item['quantity'],
					$item['variation_id'],
					$item['variation']
				);

				if ( false === $cart_item_key ) {
					throw new CartRestoreException( 'cart_add_failed' );
				}
			}

			// Aplicado antes do persist_cart() de propósito: calculate_totals()
			// (chamado lá dentro) recalcula frete/imposto com base no endereço
			// do cliente — setar depois deixaria o carrinho com totais
			// calculados para o endereço antigo (ou nenhum).
			$this->apply_customer_details( $billing_address, $shipping_address );
			// Guardado na sessão do WooCommerce (não no pedido ainda, que só
			// existe quando o cliente confirma o checkout nativo) — o hook
			// OrderOwnerToken lê este valor de volta em
			// woocommerce_checkout_update_order_meta e o copia para o pedido.
			WC()->session->set( 'persi_checkout_owner_token', $owner_token );
			$this->persist_cart();
		} catch ( \Throwable $exception ) {
			if ( $exception instanceof CartRestoreException ) {
				throw $exception;
			}

			throw new CartRestoreException( 'cart_restore_failed' );
		}
	}

	// Convidado: não cria conta nem loga o cliente no WordPress, só
	// pré-preenche os campos de cobrança/entrega do checkout nativo com o
	// que ele já digitou no Next.js, pelo mecanismo padrão do WooCommerce
	// (sessão do WC_Customer) — evita ele redigitar tudo de novo.
	private function apply_customer_details( array $billing_address, array $shipping_address ): void {
		$customer = WC()->customer;

		$customer->set_billing_first_name( $billing_address['firstName'] );
		$customer->set_billing_last_name( $billing_address['lastName'] );
		if ( isset( $billing_address['company'] ) ) {
			$customer->set_billing_company( $billing_address['company'] );
		}
		$customer->set_billing_address_1( $billing_address['address1'] );
		if ( isset( $billing_address['address2'] ) ) {
			$customer->set_billing_address_2( $billing_address['address2'] );
		}
		$customer->set_billing_city( $billing_address['city'] );
		$customer->set_billing_state( $billing_address['state'] );
		$customer->set_billing_postcode( $billing_address['postcode'] );
		$customer->set_billing_country( $billing_address['country'] );
		if ( isset( $billing_address['email'] ) ) {
			$customer->set_billing_email( $billing_address['email'] );
		}
		if ( isset( $billing_address['phone'] ) ) {
			$customer->set_billing_phone( $billing_address['phone'] );
		}

		$customer->set_shipping_first_name( $shipping_address['firstName'] );
		$customer->set_shipping_last_name( $shipping_address['lastName'] );
		if ( isset( $shipping_address['company'] ) ) {
			$customer->set_shipping_company( $shipping_address['company'] );
		}
		$customer->set_shipping_address_1( $shipping_address['address1'] );
		if ( isset( $shipping_address['address2'] ) ) {
			$customer->set_shipping_address_2( $shipping_address['address2'] );
		}
		$customer->set_shipping_city( $shipping_address['city'] );
		$customer->set_shipping_state( $shipping_address['state'] );
		$customer->set_shipping_postcode( $shipping_address['postcode'] );
		$customer->set_shipping_country( $shipping_address['country'] );

		$customer->save();
	}

	public function recover_snapshot( array $snapshot ): bool {
		try {
			WC()->cart->empty_cart();
			$fully_recovered = true;

			foreach ( $snapshot as $item ) {
				$cart_item_key = WC()->cart->add_to_cart(
					$item['product_id'],
					$item['quantity'],
					$item['variation_id'],
					$item['variation'],
					$item['cart_item_data']
				);

				if ( false === $cart_item_key ) {
					$fully_recovered = false;
				}
			}

			$this->persist_cart();

			return $fully_recovered;
		} catch ( \Throwable $exception ) {
			return false;
		}
	}

	private function validate_simple_product( $product, int $product_id, int $quantity ): array {
		if ( ! $product->is_type( 'simple' ) ) {
			throw new CartRestoreException( 'unsupported_product_type' );
		}

		$this->validate_purchasability_and_stock( $product, $quantity );

		return array(
			'product_id'   => $product_id,
			'variation_id' => 0,
			'quantity'     => $quantity,
			'variation'    => array(),
		);
	}

	private function validate_variation(
		$parent,
		int $product_id,
		int $variation_id,
		int $quantity
	): array {
		if ( ! $parent->is_type( 'variable' ) ) {
			throw new CartRestoreException( 'variation_parent_invalid' );
		}

		$variation = $this->get_product( $variation_id );

		if ( ! $variation || ! $variation->is_type( 'variation' ) ) {
			throw new CartRestoreException( 'variation_not_found' );
		}

		if ( (int) $variation->get_parent_id() !== $product_id ) {
			throw new CartRestoreException( 'variation_parent_mismatch' );
		}

		if ( 'publish' !== $variation->get_status() || ! $variation->variation_is_visible() ) {
			throw new CartRestoreException( 'variation_invalid' );
		}

		$this->validate_purchasability_and_stock( $variation, $quantity );

		$attributes = $variation->get_variation_attributes();

		if ( ! is_array( $attributes ) ) {
			throw new CartRestoreException( 'variation_invalid' );
		}

		return array(
			'product_id'   => $product_id,
			'variation_id' => $variation_id,
			'quantity'     => $quantity,
			'variation'    => $attributes,
		);
	}

	private function validate_purchasability_and_stock( $product, int $quantity ): void {
		if ( ! $product->is_purchasable() ) {
			throw new CartRestoreException( 'product_not_purchasable' );
		}

		if ( $product->is_sold_individually() && $quantity > 1 ) {
			throw new CartRestoreException( 'sold_individually' );
		}

		$maximum_quantity = $product->get_max_purchase_quantity();

		if ( $maximum_quantity >= 0 && $quantity > $maximum_quantity ) {
			throw new CartRestoreException( 'maximum_quantity_exceeded' );
		}

		if ( ! $product->is_in_stock() || ! $product->has_enough_stock( $quantity ) ) {
			throw new CartRestoreException( 'insufficient_stock' );
		}
	}

	private function validate_cart_item_requirements( array $item ): void {
		if ( ! function_exists( 'apply_filters' ) ) {
			return;
		}

		$is_valid = apply_filters(
			'woocommerce_add_to_cart_validation',
			true,
			$item['product_id'],
			$item['quantity'],
			$item['variation_id'],
			$item['variation']
		);

		if ( ! $is_valid ) {
			throw new CartRestoreException( 'product_requires_cart_item_data' );
		}

		$cart_item_data = apply_filters(
			'woocommerce_add_cart_item_data',
			array(),
			$item['product_id'],
			$item['variation_id'],
			$item['quantity']
		);

		if ( ! empty( $cart_item_data ) ) {
			throw new CartRestoreException( 'product_requires_cart_item_data' );
		}
	}

	private function persist_cart(): void {
		WC()->cart->calculate_totals();
		WC()->cart->set_session();
		WC()->session->set_customer_session_cookie( true );
	}

	private function get_product( int $product_id ) {
		if ( null !== $this->product_resolver ) {
			return call_user_func( $this->product_resolver, $product_id );
		}

		return wc_get_product( $product_id );
	}
}
