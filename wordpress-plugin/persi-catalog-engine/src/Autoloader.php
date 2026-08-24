<?php

namespace Persi\CatalogEngine;

defined( 'ABSPATH' ) || exit;

final class Autoloader {
	private const PREFIX = 'Persi\\CatalogEngine\\';

	public static function register(): void {
		spl_autoload_register( array( self::class, 'load' ) );
	}

	private static function load( string $class_name ): void {
		if ( 0 !== strpos( $class_name, self::PREFIX ) ) {
			return;
		}

		$relative = substr( $class_name, strlen( self::PREFIX ) );
		$file     = PERSI_CATALOG_ENGINE_PATH . 'src/' . str_replace( '\\', DIRECTORY_SEPARATOR, $relative ) . '.php';

		if ( is_readable( $file ) ) {
			require_once $file;
		}
	}
}
