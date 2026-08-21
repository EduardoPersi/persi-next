<?php

namespace Persi\HeadlessCheckout\Security;

defined( 'ABSPATH' ) || exit;

final class RequestAuthenticator {
	public const METHOD = 'POST';
	public const ROUTE_PATH = '/wp-json/persi-headless/v1/checkout-transfer';
	public const DEFAULT_KEY_ID = 'primary';
	public const MAX_CLOCK_SKEW = 120;

	public function authenticate(
		array $headers,
		string $raw_body,
		int $current_timestamp,
		string $secret,
		array $allowed_origins,
		string $route_path = self::ROUTE_PATH
	): AuthenticationResult {
		if ( '' === $secret ) {
			throw new AuthenticationException( 'service_unavailable' );
		}

		$key_id    = $this->header( $headers, 'x-persi-key-id' );
		$timestamp = $this->header( $headers, 'x-persi-timestamp' );
		$nonce     = $this->header( $headers, 'x-persi-nonce' );
		$origin    = $this->normalize_origin( $this->header( $headers, 'x-persi-origin' ) );
		$signature = $this->header( $headers, 'x-persi-signature' );

		if (
			! preg_match( '/^[A-Za-z0-9._-]{1,40}$/', $key_id )
			|| strtolower( $key_id ) !== strtolower( self::configured_key_id() )
		) {
			throw new AuthenticationException( 'invalid_credentials' );
		}

		if ( ! preg_match( '/^[0-9]{10,13}$/', $timestamp ) ) {
			throw new AuthenticationException( 'invalid_credentials' );
		}

		$request_timestamp = (int) $timestamp;

		if ( abs( $current_timestamp - $request_timestamp ) > self::MAX_CLOCK_SKEW ) {
			throw new AuthenticationException( 'stale_request' );
		}

		if ( ! preg_match( '/^[A-Za-z0-9_-]{22,128}$/', $nonce ) ) {
			throw new AuthenticationException( 'invalid_credentials' );
		}

		$normalized_allowed_origins = array_map( array( $this, 'normalize_origin' ), $allowed_origins );

		if ( '' === $origin || ! in_array( $origin, $normalized_allowed_origins, true ) ) {
			throw new AuthenticationException( 'invalid_origin' );
		}

		if ( ! preg_match( '/^v1=([a-f0-9]{64})$/', $signature, $matches ) ) {
			throw new AuthenticationException( 'invalid_credentials' );
		}

		$canonical_request = self::canonical_request(
			$timestamp,
			$nonce,
			$origin,
			$raw_body,
			$route_path
		);
		$expected_signature = hash_hmac( 'sha256', $canonical_request, $secret );

		if ( ! hash_equals( $expected_signature, $matches[1] ) ) {
			throw new AuthenticationException( 'invalid_credentials' );
		}

		return new AuthenticationResult( $key_id, $nonce, $origin );
	}

	public static function canonical_request(
		string $timestamp,
		string $nonce,
		string $origin,
		string $raw_body,
		string $route_path = self::ROUTE_PATH
	): string {
		return implode(
			"\n",
			array(
				self::METHOD,
				$route_path,
				$timestamp,
				$nonce,
				$origin,
				hash( 'sha256', $raw_body ),
			)
		);
	}

	public static function resolve_secret(): string {
		if ( defined( 'PERSI_HEADLESS_CHECKOUT_HMAC_SECRET' ) ) {
			$secret = constant( 'PERSI_HEADLESS_CHECKOUT_HMAC_SECRET' );

			return is_string( $secret ) ? trim( $secret ) : '';
		}

		$secret = getenv( 'PERSI_HEADLESS_CHECKOUT_HMAC_SECRET' );

		return is_string( $secret ) ? trim( $secret ) : '';
	}

	public static function configured_key_id(): string {
		if ( defined( 'PERSI_HEADLESS_CHECKOUT_HMAC_KEY_ID' ) ) {
			$key_id = constant( 'PERSI_HEADLESS_CHECKOUT_HMAC_KEY_ID' );

			if ( is_string( $key_id ) && preg_match( '/^[A-Za-z0-9._-]{1,40}$/', $key_id ) ) {
				return $key_id;
			}
		}

		return self::DEFAULT_KEY_ID;
	}

	private function header( array $headers, string $name ): string {
		$normalized = array_change_key_case( $headers, CASE_LOWER );
		$value      = $normalized[ $name ] ?? '';

		return is_string( $value ) ? trim( $value ) : '';
	}

	private function normalize_origin( string $origin ): string {
		$parts = parse_url( trim( $origin ) );

		if (
			false === $parts
			|| ! isset( $parts['scheme'], $parts['host'] )
			|| ! in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true )
			|| isset( $parts['user'] )
			|| isset( $parts['pass'] )
			|| isset( $parts['query'] )
			|| isset( $parts['fragment'] )
			|| ( isset( $parts['path'] ) && ! in_array( $parts['path'], array( '', '/' ), true ) )
		) {
			return '';
		}

		$normalized = strtolower( $parts['scheme'] ) . '://' . strtolower( $parts['host'] );

		if ( isset( $parts['port'] ) ) {
			$normalized .= ':' . (int) $parts['port'];
		}

		return $normalized;
	}
}
