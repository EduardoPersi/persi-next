<?php

namespace Persi\CatalogEngine\Support;

defined( 'ABSPATH' ) || exit;

final class Lock {
	private const OPTION = 'persi_catalog_engine_lock';
	private const TTL    = 1800;

	public function active_run_id(): int {
		$current = get_option( self::OPTION, array() );
		if ( ! is_array( $current ) || absint( $current['expires'] ?? 0 ) <= time() ) { return 0; }
		return absint( $current['run_id'] ?? 0 );
	}

	public function acquire( int $run_id ): bool {
		$now      = time();
		$current  = get_option( self::OPTION, array() );
		$expires  = is_array( $current ) ? absint( $current['expires'] ?? 0 ) : 0;

		if ( $expires > $now && absint( $current['run_id'] ?? 0 ) !== $run_id ) {
			return false;
		}

		delete_option( self::OPTION );
		return add_option(
			self::OPTION,
			array( 'run_id' => $run_id, 'expires' => $now + self::TTL ),
			'',
			false
		);
	}

	public function refresh( int $run_id ): void {
		$current = get_option( self::OPTION, array() );
		if ( is_array( $current ) && absint( $current['run_id'] ?? 0 ) === $run_id ) {
			update_option( self::OPTION, array( 'run_id' => $run_id, 'expires' => time() + self::TTL ), false );
		}
	}

	public function release( int $run_id ): void {
		$current = get_option( self::OPTION, array() );
		if ( is_array( $current ) && absint( $current['run_id'] ?? 0 ) === $run_id ) {
			delete_option( self::OPTION );
		}
	}
}
