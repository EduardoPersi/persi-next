<?php

namespace Persi\HeadlessAccount\Support;

defined( 'ABSPATH' ) || exit;

final class Logger {
	private const EVENTS = array(
		'hmac_rejected',
		'nonce_replay_rejected',
		'login_rejected',
		'login_rate_limited',
		'session_created',
		'session_storage_failed',
		'session_invalid',
		'session_valid',
		'session_revoked',
	);

	public function write(
		string $level,
		string $event,
		string $code = '',
		string $key_id = ''
	): void {
		if (
			! in_array( $event, self::EVENTS, true ) ||
			! in_array( $level, array( 'info', 'warning', 'error' ), true ) ||
			! function_exists( 'wc_get_logger' )
		) {
			return;
		}

		wc_get_logger()->log(
			$level,
			$event,
			array(
				'source' => 'persi-headless-account',
				'code'   => preg_replace( '/[^A-Z0-9_-]/', '', strtoupper( $code ) ),
				'key_id' => preg_replace( '/[^A-Za-z0-9._-]/', '', $key_id ),
			)
		);
	}
}
