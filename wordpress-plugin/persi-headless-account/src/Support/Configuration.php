<?php

namespace Persi\HeadlessAccount\Support;

defined( 'ABSPATH' ) || exit;

final class Configuration {
	public const HMAC_SECRET = 'PERSI_HEADLESS_ACCOUNT_HMAC_SECRET';
	public const HMAC_KEY_ID = 'PERSI_HEADLESS_ACCOUNT_HMAC_KEY_ID';
	public const ALLOWED_ORIGINS = 'PERSI_HEADLESS_ACCOUNT_ALLOWED_ORIGINS';

	public const CLOCK_SKEW_SECONDS = 120;
	public const NONCE_TTL_SECONDS = 300;
	public const BODY_LIMIT_BYTES = 8192;
	public const IDLE_SECONDS = 7200;
	public const ABSOLUTE_SECONDS = 86400;
	public const REMEMBER_IDLE_SECONDS = 604800;
	public const REMEMBER_ABSOLUTE_SECONDS = 2592000;
	public const LOGIN_WINDOW_SECONDS = 900;
	public const LOGIN_MAX_ATTEMPTS = 5;
	public const LOGIN_MAX_BACKOFF_SECONDS = 900;

	public function secret(): string {
		return $this->value( self::HMAC_SECRET );
	}

	public function key_id(): string {
		$value = $this->value( self::HMAC_KEY_ID );
		return preg_match( '/^[A-Za-z0-9._-]{1,40}$/', $value )
			? $value
			: 'primary';
	}

	public function allowed_origins(): array {
		$value = defined( self::ALLOWED_ORIGINS )
			? constant( self::ALLOWED_ORIGINS )
			: getenv( self::ALLOWED_ORIGINS );
		$items = is_array( $value ) ? $value : explode( ',', (string) $value );

		return array_values(
			array_filter(
				array_unique(
					array_map( array( OriginNormalizer::class, 'normalize' ), $items )
				)
			)
		);
	}

	private function value( string $name ): string {
		if ( defined( $name ) ) {
			$value = constant( $name );
			return is_string( $value ) ? trim( $value ) : '';
		}

		$value = getenv( $name );
		return is_string( $value ) ? trim( $value ) : '';
	}
}
