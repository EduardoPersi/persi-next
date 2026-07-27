<?php

namespace Persi\HeadlessAccount\Security;

use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\OriginNormalizer;

defined( 'ABSPATH' ) || exit;

final class RequestAuthenticator {
	public function __construct(
		private readonly Configuration $configuration,
		private readonly NonceRepository $nonces
	) {}

	public function authenticate(
		string $method,
		string $path,
		array $headers,
		string $raw_body,
		?int $now = null
	): AuthenticationResult {
		$secret = $this->configuration->secret();
		if (
			'' === $secret ||
			empty( $this->configuration->allowed_origins() )
		) {
			throw new AuthenticationException( 'service_unavailable' );
		}

		$now       = $now ?? time();
		$key_id    = $this->header( $headers, 'x-persi-key-id' );
		$timestamp = $this->header( $headers, 'x-persi-timestamp' );
		$nonce     = $this->header( $headers, 'x-persi-nonce' );
		$origin    = OriginNormalizer::normalize(
			$this->header( $headers, 'x-persi-origin' )
		);
		$signature = $this->header( $headers, 'x-persi-signature' );

		if (
			$key_id !== $this->configuration->key_id() ||
			! preg_match( '/^[A-Za-z0-9._-]{1,40}$/', $key_id ) ||
			! preg_match( '/^[0-9]{10,13}$/', $timestamp ) ||
			abs( $now - (int) $timestamp ) > Configuration::CLOCK_SKEW_SECONDS ||
			! preg_match( '/^[A-Za-z0-9_-]{22,128}$/', $nonce ) ||
			'' === $origin ||
			! in_array( $origin, $this->configuration->allowed_origins(), true ) ||
			! preg_match( '/^v1=([a-f0-9]{64})$/', $signature, $matches )
		) {
			throw new AuthenticationException( 'invalid_credentials' );
		}

		$canonical = self::canonical(
			strtoupper( $method ),
			$path,
			$timestamp,
			$nonce,
			$origin,
			$raw_body
		);
		$expected = hash_hmac( 'sha256', $canonical, $secret );

		if ( ! hash_equals( $expected, $matches[1] ) ) {
			throw new AuthenticationException( 'invalid_credentials' );
		}

		$nonce_hash = hash_hmac( 'sha256', $nonce, $secret );
		if (
			! $this->nonces->claim(
				$nonce_hash,
				$now,
				Configuration::NONCE_TTL_SECONDS
			)
		) {
			throw new AuthenticationException( 'replay' );
		}

		return new AuthenticationResult( $key_id, $nonce, $origin );
	}

	public static function canonical(
		string $method,
		string $path,
		string $timestamp,
		string $nonce,
		string $origin,
		string $raw_body
	): string {
		return implode(
			"\n",
			array(
				$method,
				$path,
				$timestamp,
				$nonce,
				$origin,
				hash( 'sha256', $raw_body ),
			)
		);
	}

	private function header( array $headers, string $name ): string {
		$headers = array_change_key_case( $headers, CASE_LOWER );
		$value   = $headers[ $name ] ?? '';
		return is_string( $value ) ? trim( $value ) : '';
	}
}
