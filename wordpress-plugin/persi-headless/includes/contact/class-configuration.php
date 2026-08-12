<?php
defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Contact_Configuration {
	const CLOCK_SKEW = 120;

	public static function value( $name ) {
		if ( defined( $name ) ) {
			$value = constant( $name );
			return is_string( $value ) ? trim( $value ) : '';
		}
		$value = getenv( $name );
		return is_string( $value ) ? trim( $value ) : '';
	}

	public static function secret() { return self::value( 'PERSI_HEADLESS_CONTACT_HMAC_SECRET' ); }
	public static function key_id() { $value = self::value( 'PERSI_HEADLESS_CONTACT_HMAC_KEY_ID' ); return preg_match( '/^[A-Za-z0-9._-]{1,40}$/', $value ) ? $value : 'primary'; }
	public static function origins() {
		$value = self::value( 'PERSI_HEADLESS_CONTACT_ALLOWED_ORIGINS' );
		return array_values( array_filter( array_unique( array_map( array( self::class, 'normalize_origin' ), explode( ',', $value ) ) ) ) );
	}
	public static function trusted_proxy_ips() {
		$value = self::value( 'PERSI_HEADLESS_CONTACT_TRUSTED_PROXY_IPS' );
		return array_values( array_filter( array_map( 'trim', explode( ',', $value ) ), static function ( $ip ) { return false !== filter_var( $ip, FILTER_VALIDATE_IP ); } ) );
	}
	public static function recipient() {
		$value = self::value( 'PERSI_HEADLESS_CONTACT_RECIPIENT_EMAIL' );
		return is_email( $value ) ? $value : get_option( 'admin_email' );
	}
	public static function normalize_origin( $origin ) {
		$parts = wp_parse_url( trim( (string) $origin ) );
		if ( false === $parts || ! isset( $parts['scheme'], $parts['host'] ) || ! in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true ) || isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) || ( isset( $parts['path'] ) && ! in_array( $parts['path'], array( '', '/' ), true ) ) ) return '';
		$value = strtolower( $parts['scheme'] ) . '://' . strtolower( $parts['host'] );
		return isset( $parts['port'] ) ? $value . ':' . absint( $parts['port'] ) : $value;
	}
}
