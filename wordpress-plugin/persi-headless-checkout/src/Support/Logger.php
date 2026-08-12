<?php

namespace Persi\HeadlessCheckout\Support;

defined( 'ABSPATH' ) || exit;

final class Logger {
	private const ALLOWED_EVENTS = array(
		'authentication_failed',
		'payload_rejected',
		'payload_encoding_failed',
		'nonce_replay_rejected',
		'transfer_storage_failed',
		'token_consumption_failed',
		'snapshot_recovery_failed',
	);

	public function warning( string $event ): void {
		$this->write( 'warning', $event );
	}

	public function error( string $event ): void {
		$this->write( 'error', $event );
	}

	private function write( string $level, string $event ): void {
		if ( ! in_array( $event, self::ALLOWED_EVENTS, true ) || ! function_exists( 'wc_get_logger' ) ) {
			return;
		}

		wc_get_logger()->log(
			$level,
			$event,
			array( 'source' => 'persi-headless-checkout' )
		);
	}
}
