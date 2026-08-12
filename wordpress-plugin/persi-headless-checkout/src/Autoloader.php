<?php

namespace Persi\HeadlessCheckout;

defined( 'ABSPATH' ) || exit;

final class Autoloader {
	private const PREFIX = 'Persi\\HeadlessCheckout\\';

	public static function register(): void {
		spl_autoload_register( array( self::class, 'load' ) );
	}

	private static function load( string $class_name ): void {
		if ( 0 !== strpos( $class_name, self::PREFIX ) ) {
			return;
		}

		$relative_class = substr( $class_name, strlen( self::PREFIX ) );
		$relative_path  = str_replace( '\\', DIRECTORY_SEPARATOR, $relative_class ) . '.php';
		$file_path      = PERSI_HEADLESS_CHECKOUT_PATH . 'src/' . $relative_path;

		if ( is_readable( $file_path ) ) {
			require_once $file_path;
		}
	}
}
