<?php

namespace Persi\HeadlessCheckout\Support;

defined( 'ABSPATH' ) || exit;

final class Configuration {
	public const CART_URL_CONSTANT = 'PERSI_HEADLESS_CHECKOUT_CART_URL';

	public function cart_url(): string {
		if ( defined( self::CART_URL_CONSTANT ) ) {
			$configured_url = constant( self::CART_URL_CONSTANT );

			return is_string( $configured_url ) ? self::validate_http_url( $configured_url ) : '';
		}

		if ( ! function_exists( 'wc_get_cart_url' ) ) {
			return '';
		}

		$fallback_url = wc_get_cart_url();

		return is_string( $fallback_url ) ? self::validate_http_url( $fallback_url ) : '';
	}

	public function has_invalid_configured_cart_url(): bool {
		return defined( self::CART_URL_CONSTANT ) && '' === $this->cart_url();
	}

	public static function validate_http_url( string $url ): string {
		$url   = trim( $url );
		$parts = parse_url( $url );

		if (
			'' === $url
			|| false === filter_var( $url, FILTER_VALIDATE_URL )
			|| false === $parts
			|| ! isset( $parts['scheme'], $parts['host'] )
			|| ! in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true )
			|| isset( $parts['user'] )
			|| isset( $parts['pass'] )
		) {
			return '';
		}

		return $url;
	}
}
