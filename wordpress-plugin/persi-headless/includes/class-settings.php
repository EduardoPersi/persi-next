<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Settings {
	const OPTION = 'persi_headless_settings';

	public static function all() {
		$value = get_option( self::OPTION, array() );
		return is_array( $value ) ? $value : array();
	}

	public static function module_enabled( $module ) {
		$settings = self::all();
		return ! empty( $settings['modules'][ $module ] );
	}

	public static function get( $key, $default = null ) {
		$settings = self::all();
		return array_key_exists( $key, $settings ) ? $settings[ $key ] : $default;
	}

	public static function frontend_url( $path = '' ) {
		$urls = self::get( 'frontend_urls', array( 'https://app.persimateriais.com.br' ) );
		$base = is_array( $urls ) && ! empty( $urls[0] ) ? $urls[0] : 'https://app.persimateriais.com.br';
		return untrailingslashit( esc_url_raw( $base ) ) . '/' . ltrim( $path, '/' );
	}
}
