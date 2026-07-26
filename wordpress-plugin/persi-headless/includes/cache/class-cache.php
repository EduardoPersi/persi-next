<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Cache {
	const VERSION_OPTION = 'persi_headless_cache_version';

	public static function get( $group, $product_id ) {
		return get_transient( self::key( $group, $product_id ) );
	}

	public static function set( $group, $product_id, $value, $ttl = 60 ) {
		set_transient( self::key( $group, $product_id ), $value, min( 300, absint( $ttl ) ) );
	}

	public static function invalidate() {
		update_option( self::VERSION_OPTION, (string) microtime( true ), false );
	}

	private static function key( $group, $product_id ) {
		$version = get_option( self::VERSION_OPTION, '1' );
		$locale  = determine_locale();
		return 'persi_h_' . md5( PERSI_HEADLESS_VERSION . '|' . $version . '|' . $locale . '|' . $group . '|' . absint( $product_id ) );
	}
}
