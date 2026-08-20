<?php

namespace Persi\HeadlessCheckout\Support;

defined( 'ABSPATH' ) || exit;

final class RequestDiagnostics {
	private $started_at;

	public function register(): void {
		if ( ! defined( 'PERSI_HEADLESS_CHECKOUT_DIAGNOSTICS' ) || true !== PERSI_HEADLESS_CHECKOUT_DIAGNOSTICS ) return;
		$this->started_at = microtime( true );
		add_action( 'shutdown', array( $this, 'record' ), PHP_INT_MAX );
	}

	public function record(): void {
		if ( ! function_exists( 'wc_get_logger' ) ) return;

		global $wpdb;
		$request_uri = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '/';
		$path = wp_parse_url( $request_uri, PHP_URL_PATH );
		$wc_ajax = isset( $_GET['wc-ajax'] ) && is_string( $_GET['wc-ajax'] )
			? sanitize_key( wp_unslash( $_GET['wc-ajax'] ) )
			: '';

		wc_get_logger()->info(
			'checkout_request_diagnostic',
			array(
				'source'       => 'persi-headless-checkout-diagnostics',
				'path'         => is_string( $path ) ? $path : '/',
				'request_type' => $this->request_type( $wc_ajax ),
				'wc_ajax'      => $wc_ajax,
				'elapsed_ms'   => (int) round( ( microtime( true ) - $this->started_at ) * 1000 ),
				'memory_bytes' => memory_get_peak_usage( true ),
				'queries'      => isset( $wpdb->num_queries ) ? (int) $wpdb->num_queries : 0,
				'has_session'  => function_exists( 'WC' ) && null !== WC()->session,
				'has_cart'     => function_exists( 'WC' ) && null !== WC()->cart,
			)
		);
	}

	private function request_type( string $wc_ajax ): string {
		if ( '' !== $wc_ajax ) return 'wc-ajax';
		if ( function_exists( 'wp_doing_ajax' ) && wp_doing_ajax() ) return 'admin-ajax';
		if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) return 'rest';
		if ( function_exists( 'is_checkout' ) && is_checkout() ) return 'checkout';
		return 'other';
	}
}
