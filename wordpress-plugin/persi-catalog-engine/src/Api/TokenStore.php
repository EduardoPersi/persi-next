<?php

namespace Persi\CatalogEngine\Api;

defined( 'ABSPATH' ) || exit;

final class TokenStore {
	private const OPTION = 'persi_catalog_olist_tokens';

	public function get(): array {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			return array();
		}

		$access  = $this->decrypt( (string) ( $stored['access'] ?? '' ) );
		$refresh = $this->decrypt( (string) ( $stored['refresh'] ?? '' ) );
		return array(
			'access_token'  => $access,
			'refresh_token' => $refresh,
			'expires_at'    => absint( $stored['expires_at'] ?? 0 ),
		);
	}

	public function save( string $access, string $refresh, int $expires_in ): bool {
		$access_cipher  = $this->encrypt( $access );
		$refresh_cipher = $this->encrypt( $refresh );
		if ( '' === $access_cipher || '' === $refresh_cipher ) {
			return false;
		}

		return update_option(
			self::OPTION,
			array(
				'access'     => $access_cipher,
				'refresh'    => $refresh_cipher,
				'expires_at' => time() + max( 60, $expires_in - 60 ),
			),
			false
		);
	}

	public function clear(): void {
		delete_option( self::OPTION );
	}

	public function expire_access(): void {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) { return; }
		$stored['expires_at'] = 0;
		update_option( self::OPTION, $stored, false );
	}

	private function key(): string {
		return hash( 'sha256', wp_salt( 'auth' ), true );
	}

	private function encrypt( string $value ): string {
		if ( '' === $value || ! function_exists( 'openssl_encrypt' ) ) {
			return '';
		}
		$iv     = random_bytes( 12 );
		$tag    = '';
		$cipher = openssl_encrypt( $value, 'aes-256-gcm', $this->key(), OPENSSL_RAW_DATA, $iv, $tag );
		return false === $cipher ? '' : base64_encode( $iv . $tag . $cipher );
	}

	private function decrypt( string $encoded ): string {
		$raw = base64_decode( $encoded, true );
		if ( false === $raw || strlen( $raw ) < 29 || ! function_exists( 'openssl_decrypt' ) ) {
			return '';
		}
		$value = openssl_decrypt( substr( $raw, 28 ), 'aes-256-gcm', $this->key(), OPENSSL_RAW_DATA, substr( $raw, 0, 12 ), substr( $raw, 12, 16 ) );
		return false === $value ? '' : $value;
	}
}
