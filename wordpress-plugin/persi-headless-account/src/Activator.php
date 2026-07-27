<?php

namespace Persi\HeadlessAccount;

defined( 'ABSPATH' ) || exit;

final class Activator {
	public const DATABASE_VERSION = '1';

	public static function activate(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset = $wpdb->get_charset_collate();
		$prefix  = $wpdb->prefix;

		dbDelta(
			"CREATE TABLE {$prefix}persi_account_sessions (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				token_hash char(64) NOT NULL,
				user_id bigint(20) unsigned NOT NULL,
				status varchar(20) NOT NULL DEFAULT 'active',
				created_at datetime NOT NULL,
				last_seen_at datetime NOT NULL,
				idle_expires_at datetime NOT NULL,
				absolute_expires_at datetime NOT NULL,
				revoked_at datetime NULL DEFAULT NULL,
				rotation_parent_hash char(64) NULL DEFAULT NULL,
				user_agent_hash char(64) NULL DEFAULT NULL,
				ip_hash char(64) NULL DEFAULT NULL,
				failure_code varchar(64) NULL DEFAULT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY token_hash (token_hash),
				KEY user_status (user_id, status),
				KEY status_idle (status, idle_expires_at),
				KEY status_absolute (status, absolute_expires_at)
			) {$charset};"
		);

		dbDelta(
			"CREATE TABLE {$prefix}persi_account_nonces (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				nonce_hash char(64) NOT NULL,
				expires_at datetime NOT NULL,
				created_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY nonce_hash (nonce_hash),
				KEY expires_at (expires_at)
			) {$charset};"
		);

		dbDelta(
			"CREATE TABLE {$prefix}persi_account_rate_limits (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				bucket_hash char(64) NOT NULL,
				window_started_at datetime NOT NULL,
				attempts int(10) unsigned NOT NULL DEFAULT 0,
				blocked_until datetime NULL DEFAULT NULL,
				updated_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY bucket_hash (bucket_hash),
				KEY blocked_until (blocked_until),
				KEY updated_at (updated_at)
			) {$charset};"
		);

		update_option(
			'persi_headless_account_db_version',
			self::DATABASE_VERSION,
			false
		);
	}
}
