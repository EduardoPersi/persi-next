<?php
defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Contact_Authenticator {
	public function authenticate( WP_REST_Request $request, $path ) {
		$secret = Persi_Headless_Contact_Configuration::secret();
		$key_id = trim( (string) $request->get_header( 'x-persi-key-id' ) );
		$timestamp = trim( (string) $request->get_header( 'x-persi-timestamp' ) );
		$nonce = trim( (string) $request->get_header( 'x-persi-nonce' ) );
		$origin = Persi_Headless_Contact_Configuration::normalize_origin( $request->get_header( 'x-persi-origin' ) );
		$signature = trim( (string) $request->get_header( 'x-persi-signature' ) );
		if ( '' === $secret || empty( Persi_Headless_Contact_Configuration::origins() ) ) return new WP_Error( 'service_unavailable', 'Serviço indisponível.', array( 'status' => 503 ) );
		if ( ! preg_match( '/^[A-Za-z0-9._-]{1,40}$/', $key_id ) || strtolower( $key_id ) !== strtolower( Persi_Headless_Contact_Configuration::key_id() ) || ! preg_match( '/^[0-9]{10,13}$/', $timestamp ) || abs( time() - (int) $timestamp ) > Persi_Headless_Contact_Configuration::CLOCK_SKEW || ! preg_match( '/^[A-Za-z0-9_-]{22,128}$/', $nonce ) || ! in_array( $origin, Persi_Headless_Contact_Configuration::origins(), true ) || ! preg_match( '/^v1=([a-f0-9]{64})$/', $signature, $matches ) ) return new WP_Error( 'invalid_credentials', 'Não autorizado.', array( 'status' => 401 ) );
		$body = $request->get_body();
		$canonical = implode( "\n", array( strtoupper( $request->get_method() ), $path, $timestamp, $nonce, $origin, hash( 'sha256', $body ) ) );
		if ( ! hash_equals( hash_hmac( 'sha256', $canonical, $secret ), $matches[1] ) ) return new WP_Error( 'invalid_credentials', 'Não autorizado.', array( 'status' => 401 ) );
		if ( ! $this->claim_nonce( hash_hmac( 'sha256', $nonce, $secret ) ) ) return new WP_Error( 'replay', 'Não autorizado.', array( 'status' => 409 ) );
		return array( 'origin' => $origin, 'key_id' => $key_id );
	}

	// Sem tabela dedicada de nonces (diferente de newsletter/stock-notifications):
	// o formulário de contato não guarda estado entre requisições, então um
	// transient (expira sozinho após a janela de CLOCK_SKEW) já garante a
	// mesma proteção contra replay sem exigir uma migração de banco nova.
	private function claim_nonce( $nonce_hash ) {
		$key = 'persi_contact_nonce_' . $nonce_hash;
		if ( false !== get_transient( $key ) ) return false;
		set_transient( $key, 1, Persi_Headless_Contact_Configuration::CLOCK_SKEW * 2 );
		return true;
	}
}
