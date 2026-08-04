<?php

namespace Persi\HeadlessAccount;

defined( 'ABSPATH' ) || exit;

final class Activator {
	public const DATABASE_VERSION = '5';

	public static function maybe_upgrade(): void {
		if ( self::DATABASE_VERSION !== get_option( 'persi_headless_account_db_version' ) ) {
			self::activate();
		}
	}

	public static function activate(): void {
		global $wpdb;
		$previous_version = (string) get_option( 'persi_headless_account_db_version', '' );

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset = $wpdb->get_charset_collate();
		$prefix  = $wpdb->prefix;

		dbDelta(
			"CREATE TABLE {$prefix}persi_customer_lists (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				user_id bigint(20) unsigned NOT NULL,
				list_type varchar(32) NOT NULL,
				product_id bigint(20) unsigned NOT NULL,
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY user_list_product (user_id, list_type, product_id),
				KEY user_list_created (user_id, list_type, created_at),
				KEY product_id (product_id)
			) {$charset};"
		);

		$legacy_table = $prefix . 'persi_favorites';
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $legacy_table ) ) === $legacy_table ) {
			$wpdb->query(
				"INSERT IGNORE INTO {$prefix}persi_customer_lists (user_id, list_type, product_id, created_at, updated_at)
				SELECT user_id, 'favorites', product_id, created_at, created_at FROM {$legacy_table}"
			);
		}

		$wpdb->query( "DROP TABLE IF EXISTS {$prefix}persi_account_sessions" );
		$wpdb->query( "DROP TABLE IF EXISTS {$prefix}persi_account_nonces" );

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

		dbDelta(
			"CREATE TABLE {$prefix}persi_account_identities (
				id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
				user_id bigint(20) unsigned NOT NULL,
				provider varchar(20) NOT NULL,
				provider_subject_hash char(64) NOT NULL,
				email_hash char(64) NOT NULL,
				created_at datetime NOT NULL,
				updated_at datetime NOT NULL,
				last_login_at datetime NOT NULL,
				PRIMARY KEY  (id),
				UNIQUE KEY provider_subject (provider, provider_subject_hash),
				UNIQUE KEY provider_email (provider, email_hash),
				KEY user_provider (user_id, provider)
			) {$charset};"
		);
		if ( '' !== $previous_version && version_compare( $previous_version, '5', '<' ) ) {
			$wpdb->query( "TRUNCATE TABLE {$prefix}persi_account_identities" );
		}

		update_option(
			'persi_headless_account_db_version',
			self::DATABASE_VERSION,
			false
		);
	}
}
