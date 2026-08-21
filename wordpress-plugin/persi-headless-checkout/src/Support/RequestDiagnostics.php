<?php

namespace Persi\HeadlessCheckout\Support;

defined( 'ABSPATH' ) || exit;

final class RequestDiagnostics {
	private $started_at;
	private $posted_checkout = array();

	public function register(): void {
		if ( ! defined( 'PERSI_HEADLESS_CHECKOUT_DIAGNOSTICS' ) || true !== PERSI_HEADLESS_CHECKOUT_DIAGNOSTICS ) return;
		$this->started_at = microtime( true );
		add_action( 'woocommerce_checkout_update_order_review', array( $this, 'capture_checkout_post' ), PHP_INT_MAX );
		add_action( 'shutdown', array( $this, 'record' ), PHP_INT_MAX );
	}

	public function capture_checkout_post( $post_data ): void {
		if ( ! is_string( $post_data ) ) return;
		parse_str( $post_data, $parsed );
		if ( ! is_array( $parsed ) ) return;
		$this->posted_checkout = array(
			'billing' => $this->destination_from_array( $parsed, 'billing_' ),
			'shipping' => $this->destination_from_array( $parsed, 'shipping_' ),
			'ship_to_different_address' => ! empty( $parsed['ship_to_different_address'] ),
			'shipping_method' => $this->shipping_method_ids( $parsed['shipping_method'] ?? array() ),
			'payment_method_present' => ! empty( $parsed['payment_method'] ),
		);
	}

	public function record(): void {
		if ( ! function_exists( 'wc_get_logger' ) ) return;
		global $wpdb;
		$wc_ajax = $this->wc_ajax_action();
		$context = array(
			'source' => 'persi-headless-checkout-diagnostics',
			'path' => $this->request_path(),
			'request_type' => $this->request_type( $wc_ajax ),
			'wc_ajax' => $wc_ajax,
			'elapsed_ms' => (int) round( ( microtime( true ) - $this->started_at ) * 1000 ),
			'memory_bytes' => memory_get_peak_usage( true ),
			'queries' => isset( $wpdb->num_queries ) ? (int) $wpdb->num_queries : 0,
			'has_session' => function_exists( 'WC' ) && null !== WC()->session,
			'has_cart' => function_exists( 'WC' ) && null !== WC()->cart,
			'cookie_presence' => $this->cookie_presence(),
			'object_cache_dropin_present' => defined( 'WP_CONTENT_DIR' ) && file_exists( WP_CONTENT_DIR . '/object-cache.php' ),
		);
		if ( 'update_order_review' === $wc_ajax ) {
			$context['post'] = $this->posted_checkout;
			$context['customer'] = $this->customer_destination();
			$context['shipping'] = $this->shipping_state();
			$context['shipping_hooks'] = $this->shipping_hooks();
		}
		wc_get_logger()->info( 'checkout_request_diagnostic', $context );
	}

	private function customer_destination(): array {
		if ( ! function_exists( 'WC' ) || null === WC()->customer ) return array();
		$customer = WC()->customer;
		return array(
			'billing' => array( 'country' => sanitize_key( $customer->get_billing_country() ), 'state' => sanitize_key( $customer->get_billing_state() ), 'postcode' => $this->mask_postcode( $customer->get_billing_postcode() ), 'city_present' => '' !== trim( (string) $customer->get_billing_city() ) ),
			'shipping' => array( 'country' => sanitize_key( $customer->get_shipping_country() ), 'state' => sanitize_key( $customer->get_shipping_state() ), 'postcode' => $this->mask_postcode( $customer->get_shipping_postcode() ), 'city_present' => '' !== trim( (string) $customer->get_shipping_city() ) ),
		);
	}

	private function shipping_state(): array {
		if ( ! function_exists( 'WC' ) || null === WC()->cart || null === WC()->shipping ) return array();
		$input_packages = WC()->cart->get_shipping_packages();
		$calculated = WC()->shipping()->get_packages();
		$packages = array();
		foreach ( $input_packages as $index => $package ) {
			$zone = class_exists( 'WC_Shipping_Zones' ) ? \WC_Shipping_Zones::get_zone_matching_package( $package ) : null;
			$methods = array();
			if ( $zone && method_exists( $zone, 'get_shipping_methods' ) ) {
				foreach ( $zone->get_shipping_methods( false ) as $method ) {
					$methods[] = array( 'id' => sanitize_key( $method->id ?? '' ), 'instance_id' => (int) ( $method->instance_id ?? 0 ), 'enabled' => 'yes' === ( $method->enabled ?? '' ) );
				}
			}
			$rates = array();
			foreach ( $calculated[ $index ]['rates'] ?? array() as $rate ) {
				$rates[] = array( 'id' => sanitize_text_field( $rate->get_id() ), 'method_id' => sanitize_key( $rate->get_method_id() ), 'instance_id' => (int) $rate->get_instance_id(), 'cost' => (string) $rate->get_cost() );
			}
			$packages[] = array(
				'index' => (int) $index,
				'destination' => $this->destination_from_package( $package['destination'] ?? array() ),
				'item_count' => is_array( $package['contents'] ?? null ) ? count( $package['contents'] ) : 0,
				'zone_id' => $zone ? (int) $zone->get_id() : null,
				'zone_name' => $zone ? sanitize_text_field( $zone->get_zone_name() ) : '',
				'methods' => $methods,
				'rates' => $rates,
			);
		}
		return array(
			'packages' => $packages,
			'chosen_methods' => $this->shipping_method_ids( WC()->session ? WC()->session->get( 'chosen_shipping_methods', array() ) : array() ),
			'cached_package_0_present' => WC()->session && null !== WC()->session->get( 'shipping_for_package_0', null ),
		);
	}

	private function shipping_hooks(): array {
		global $wp_filter;
		$hooks = array();
		foreach ( array( 'woocommerce_package_rates', 'woocommerce_shipping_packages', 'woocommerce_cart_shipping_packages', 'woocommerce_shipping_methods', 'woocommerce_checkout_update_order_review' ) as $hook_name ) {
			$hooks[ $hook_name ] = isset( $wp_filter[ $hook_name ] ) ? count( $wp_filter[ $hook_name ]->callbacks ?? array() ) : 0;
		}
		return $hooks;
	}

	private function destination_from_array( array $values, string $prefix ): array {
		return array( 'country' => sanitize_key( $values[ $prefix . 'country' ] ?? '' ), 'state' => sanitize_key( $values[ $prefix . 'state' ] ?? '' ), 'postcode' => $this->mask_postcode( $values[ $prefix . 'postcode' ] ?? '' ), 'city_present' => '' !== trim( (string) ( $values[ $prefix . 'city' ] ?? '' ) ) );
	}

	private function destination_from_package( array $destination ): array {
		return array( 'country' => sanitize_key( $destination['country'] ?? '' ), 'state' => sanitize_key( $destination['state'] ?? '' ), 'postcode' => $this->mask_postcode( $destination['postcode'] ?? '' ), 'city_present' => '' !== trim( (string) ( $destination['city'] ?? '' ) ) );
	}

	private function shipping_method_ids( $methods ): array {
		if ( ! is_array( $methods ) ) return array();
		return array_values( array_filter( array_map( 'sanitize_text_field', $methods ) ) );
	}

	private function mask_postcode( $postcode ): string {
		$digits = preg_replace( '/\D+/', '', (string) $postcode );
		return is_string( $digits ) && strlen( $digits ) >= 5 ? substr( $digits, 0, 5 ) . '***' : '';
	}

	private function cookie_presence(): array {
		$names = array_keys( $_COOKIE );
		return array( 'woocommerce_session' => 0 < count( preg_grep( '/^wp_woocommerce_session_/', $names ) ), 'cart_hash' => in_array( 'woocommerce_cart_hash', $names, true ), 'items_in_cart' => in_array( 'woocommerce_items_in_cart', $names, true ) );
	}

	private function request_path(): string {
		$request_uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/';
		$path = wp_parse_url( $request_uri, PHP_URL_PATH );
		return is_string( $path ) ? $path : '/';
	}

	private function wc_ajax_action(): string {
		return isset( $_GET['wc-ajax'] ) && is_string( $_GET['wc-ajax'] ) ? sanitize_key( wp_unslash( $_GET['wc-ajax'] ) ) : '';
	}

	private function request_type( string $wc_ajax ): string {
		if ( '' !== $wc_ajax ) return 'wc-ajax';
		if ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() ) return 'admin-ajax';
		if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) return 'rest';
		if ( function_exists( 'is_checkout' ) && is_checkout() ) return 'checkout';
		return 'other';
	}
}
