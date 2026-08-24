<?php

namespace Persi\CatalogEngine\Support;

defined( 'ABSPATH' ) || exit;

final class Performance {
	private static array $buffer = array();
	public static function enabled(): bool {
		return defined( 'PERSI_CATALOG_PERFORMANCE_DIAGNOSTICS' ) && true === constant( 'PERSI_CATALOG_PERFORMANCE_DIAGNOSTICS' );
	}

	public static function start(): int { return hrtime( true ); }
	public static function elapsed_ms( int $started ): float { return round( ( hrtime( true ) - $started ) / 1000000, 3 ); }

	public static function add( array &$metrics, string $key, float $milliseconds, int $count = 1 ): void {
		if ( ! self::enabled() ) { return; }
		if ( ! isset( $metrics[ $key ] ) ) { $metrics[ $key ] = array( 'total_ms' => 0.0, 'count' => 0 ); }
		$metrics[ $key ]['total_ms'] = round( (float) $metrics[ $key ]['total_ms'] + $milliseconds, 3 );
		$metrics[ $key ]['count'] += $count;
	}

	public static function record( string $key, float $milliseconds, int $count = 1 ): void { self::add( self::$buffer, $key, $milliseconds, $count ); }
	public static function drain(): array { $metrics = self::$buffer; self::$buffer = array(); return $metrics; }
}
