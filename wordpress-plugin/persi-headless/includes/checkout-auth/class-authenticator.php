<?php

defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Checkout_Auth_Authenticator {
	private const WINDOW_SECONDS = 300;

	public function authorize( WP_REST_Request $request ) {
		$secret = $this->configuration( 'PERSI_HEADLESS_CHECKOUT_AUTH_SECRET' );
		$key_id = $this->configuration( 'PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID', 'primary' );
		$received_key = strtolower( trim( (string) $request->get_header( 'x-persi-key-id' ) ) );
		$timestamp = trim( (string) $request->get_header( 'x-persi-timestamp' ) );
		$nonce = trim( (string) $request->get_header( 'x-persi-nonce' ) );
		$signature = strtolower( trim( (string) $request->get_header( 'x-persi-signature' ) ) );
		$client_fingerprint = strtolower( trim( (string) $request->get_header( 'x-persi-client-fingerprint' ) ) );

		if ( strlen( $secret ) < 32 || ! hash_equals( strtolower( $key_id ), $received_key ) ) {
			return new WP_Error( 'persi_checkout_auth_unauthorized', 'Solicitação não autorizada.', array( 'status' => 401 ) );
		}
		if ( ! ctype_digit( $timestamp ) || abs( time() - (int) $timestamp ) > self::WINDOW_SECONDS ) {
			return new WP_Error( 'persi_checkout_auth_expired', 'Solicitação expirada.', array( 'status' => 401 ) );
		}
		if ( 1 !== preg_match( '/^[a-f0-9-]{36}$/i', $nonce ) || 1 !== preg_match( '/^[a-f0-9]{64}$/', $signature ) || 1 !== preg_match( '/^[a-f0-9]{64}$/', $client_fingerprint ) ) {
			return new WP_Error( 'persi_checkout_auth_invalid', 'Solicitação inválida.', array( 'status' => 401 ) );
		}

		$nonce_key = 'persi_checkout_auth_nonce_' . hash( 'sha256', $nonce );
		if ( false !== get_transient( $nonce_key ) ) {
			return new WP_Error( 'persi_checkout_auth_replay', 'Solicitação repetida.', array( 'status' => 409 ) );
		}

		$canonical = implode( "\n", array(
			$timestamp,
			$nonce,
			$request->get_method(),
			$request->get_route(),
			$client_fingerprint,
			$request->get_body(),
		) );
		$expected = hash_hmac( 'sha256', $canonical, $secret );
		if ( ! hash_equals( $expected, $signature ) ) {
			return new WP_Error( 'persi_checkout_auth_signature', 'Solicitação não autorizada.', array( 'status' => 401 ) );
		}

		set_transient( $nonce_key, 1, self::WINDOW_SECONDS );
		return true;
	}

	private function configuration( string $name, string $default = '' ): string {
		$value = defined( $name ) ? constant( $name ) : getenv( $name );
		return is_string( $value ) && '' !== trim( $value ) ? trim( $value ) : $default;
	}
}
