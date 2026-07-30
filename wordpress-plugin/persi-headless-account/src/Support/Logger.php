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
		'google_hmac_rejected',
		'google_payload_rejected',
		'google_identity_rejected',
		'google_session_failed',
		'google_session_created',
		'google_email_received',
		'google_user_found',
		'google_user_created',
		'oauth_hmac_rejected',
		'oauth_payload_rejected',
		'oauth_identity_received',
		'oauth_identity_rejected',
		'oauth_user_found',
		'oauth_user_created',
		'oauth_session_failed',
		'oauth_session_created',
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
