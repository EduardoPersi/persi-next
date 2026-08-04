<?php

namespace Persi\HeadlessAccount\Support;

defined( 'ABSPATH' ) || exit;

final class Configuration {
	public const ALLOWED_ORIGINS = 'PERSI_HEADLESS_ACCOUNT_ALLOWED_ORIGINS';
	public const GOOGLE_CLIENT_ID = 'PERSI_GOOGLE_CLIENT_ID';
	public const FACEBOOK_APP_ID = 'PERSI_FACEBOOK_APP_ID';
	public const FACEBOOK_APP_SECRET = 'PERSI_FACEBOOK_APP_SECRET';
	public const FACEBOOK_GRAPH_VERSION = 'PERSI_FACEBOOK_GRAPH_VERSION';

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

	public function google_client_id(): string { return $this->value( self::GOOGLE_CLIENT_ID ); }
	public function facebook_app_id(): string { return $this->value( self::FACEBOOK_APP_ID ); }
	public function facebook_app_secret(): string { return $this->value( self::FACEBOOK_APP_SECRET ); }
	public function facebook_graph_version(): string {
		$value = $this->value( self::FACEBOOK_GRAPH_VERSION );
		return preg_match( '/^v[0-9]{1,2}\.[0-9]$/', $value ) ? $value : 'v23.0';
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
