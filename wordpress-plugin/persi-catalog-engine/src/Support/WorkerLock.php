<?php

namespace Persi\CatalogEngine\Support;

defined( 'ABSPATH' ) || exit;

final class WorkerLock {
	private const TTL = 90;

	public function acquire( int $run_id ): bool {
		$key = $this->key( $run_id );
		$expires = absint( get_option( $key, 0 ) );
		if ( $expires && $expires <= time() ) { delete_option( $key ); }
		return add_option( $key, time() + self::TTL, '', false );
	}

	public function release( int $run_id ): void {
		delete_option( $this->key( $run_id ) );
	}

	private function key( int $run_id ): string {
		return 'persi_catalog_worker_lock_' . absint( $run_id );
	}
}
