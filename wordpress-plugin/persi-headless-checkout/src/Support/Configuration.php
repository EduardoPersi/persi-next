<?php

namespace Persi\HeadlessCheckout\Support;

defined( 'ABSPATH' ) || exit;

final class Configuration {
	public const CART_URL_CONSTANT = 'PERSI_HEADLESS_CHECKOUT_CART_URL';
	public const CONFIRMATION_URL_CONSTANT = 'PERSI_HEADLESS_CHECKOUT_CONFIRMATION_URL';
	public const PUBLIC_CHECKOUT_URL_CONSTANT = 'PERSI_HEADLESS_CHECKOUT_PUBLIC_CHECKOUT_URL';

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

	// Sem fallback próprio (ao contrário de cart_url()): não existe uma URL
	// nativa do WooCommerce equivalente à página de confirmação do Next.js.
	// Sem esta constante configurada, o cliente simplesmente não é
	// redirecionado de volta — fica na própria página de pedido recebido do
	// WooCommerce, degradação segura em vez de redirecionar para algo errado.
	public function confirmation_url(): string {
		if ( ! defined( self::CONFIRMATION_URL_CONSTANT ) ) {
			return '';
		}

		$configured_url = constant( self::CONFIRMATION_URL_CONSTANT );

		return is_string( $configured_url ) ? self::validate_http_url( $configured_url ) : '';
	}

	public function has_invalid_configured_confirmation_url(): bool {
		return defined( self::CONFIRMATION_URL_CONSTANT ) && '' === $this->confirmation_url();
	}

	public function public_checkout_url(): string {
		if ( ! defined( self::PUBLIC_CHECKOUT_URL_CONSTANT ) ) {
			return '';
		}

		$configured_url = constant( self::PUBLIC_CHECKOUT_URL_CONSTANT );

		if ( ! is_string( $configured_url ) ) {
			return '';
		}

		$validated = self::validate_http_url( $configured_url );
		$parts     = '' !== $validated ? wp_parse_url( $validated ) : false;

		if (
			false === $parts
			|| 'https' !== strtolower( $parts['scheme'] ?? '' )
			|| 'persimateriais.com.br' !== strtolower( $parts['host'] ?? '' )
			|| '/checkout/' !== ( $parts['path'] ?? '' )
			|| isset( $parts['query'] )
			|| isset( $parts['fragment'] )
		) {
			return '';
		}

		return $validated;
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
