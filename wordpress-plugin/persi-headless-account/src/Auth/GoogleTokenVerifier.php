<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

final class GoogleTokenVerifier {
	private const CERTIFICATES_URL = 'https://www.googleapis.com/oauth2/v1/certs';

	public function verify( string $token, string $client_id ): ?array {
		$parts = explode( '.', $token );
		if ( 3 !== count( $parts ) || strlen( $token ) > 16384 ) return null;
		$header = $this->decode( $parts[0] );
		$claims = $this->decode( $parts[1] );
		if ( ! is_array( $header ) || ! is_array( $claims ) || 'RS256' !== ( $header['alg'] ?? null ) || ! is_string( $header['kid'] ?? null ) ) return null;

		$certificates = get_transient( 'persi_google_oauth_certificates' );
		if ( ! is_array( $certificates ) ) {
			$response = wp_safe_remote_get( self::CERTIFICATES_URL, array( 'timeout' => 10, 'redirection' => 0 ) );
			if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) return null;
			$certificates = json_decode( wp_remote_retrieve_body( $response ), true );
			if ( ! is_array( $certificates ) ) return null;
			set_transient( 'persi_google_oauth_certificates', $certificates, HOUR_IN_SECONDS );
		}
		$certificate = is_array( $certificates ) ? ( $certificates[ $header['kid'] ] ?? null ) : null;
		$signature = $this->base64url_decode( $parts[2] );
		if ( ! is_string( $certificate ) || false === $signature || 1 !== openssl_verify( $parts[0] . '.' . $parts[1], $signature, $certificate, OPENSSL_ALGO_SHA256 ) ) return null;

		$issuer = $claims['iss'] ?? '';
		if ( ! in_array( $issuer, array( 'https://accounts.google.com', 'accounts.google.com' ), true ) ) return null;
		if ( ! hash_equals( $client_id, (string) ( $claims['aud'] ?? '' ) ) ) return null;
		if ( ! is_numeric( $claims['exp'] ?? null ) || (int) $claims['exp'] <= time() ) return null;
		if ( true !== ( $claims['email_verified'] ?? false ) && 'true' !== ( $claims['email_verified'] ?? null ) ) return null;
		if ( ! is_string( $claims['sub'] ?? null ) || ! is_email( $claims['email'] ?? '' ) ) return null;
		return $claims;
	}

	private function decode( string $part ): ?array {
		$decoded = $this->base64url_decode( $part );
		if ( false === $decoded ) return null;
		$value = json_decode( $decoded, true );
		return is_array( $value ) ? $value : null;
	}

	private function base64url_decode( string $value ) {
		return base64_decode( strtr( $value, '-_', '+/' ) . str_repeat( '=', ( 4 - strlen( $value ) % 4 ) % 4 ), true );
	}
}
