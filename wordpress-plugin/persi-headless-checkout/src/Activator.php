<?php

namespace Persi\HeadlessCheckout;

defined( 'ABSPATH' ) || exit;

final class Activator {
	public const DATABASE_VERSION = '2';

	public static function maybe_upgrade(): void {
		if ( ! is_admin() || ! current_user_can( 'activate_plugins' ) ) {
			return;
		}
		if ( self::DATABASE_VERSION !== (string) get_option( 'persi_headless_checkout_db_version', '' ) ) {
			self::activate();
		}
	}

	public static function activate(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table_name      = $wpdb->prefix . 'persi_checkout_transfers';
		$charset_collate = $wpdb->get_charset_collate();
		$sql             = "CREATE TABLE {$table_name} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			token_hash char(64) NOT NULL,
			request_nonce_hash char(64) NOT NULL,
			payload_hash char(64) NOT NULL,
			payload longtext NOT NULL,
			key_id varchar(40) NOT NULL,
			status varchar(20) NOT NULL DEFAULT 'pending',
			expires_at datetime NOT NULL,
			used_at datetime NULL DEFAULT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			attempts smallint(5) unsigned NOT NULL DEFAULT 0,
			failure_code varchar(64) NULL DEFAULT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY token_hash (token_hash),
			UNIQUE KEY request_nonce_hash (request_nonce_hash),
			KEY status_expires (status, expires_at)
		) {$charset_collate};";

		dbDelta( $sql );

		$attempts_table = $wpdb->prefix . 'persi_checkout_attempts';
		$attempts_sql   = "CREATE TABLE {$attempts_table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			checkout_attempt_id char(36) NOT NULL,
			order_id bigint(20) unsigned NULL DEFAULT NULL,
			payment_provider varchar(32) NOT NULL,
			payment_method varchar(32) NOT NULL,
			provider_reference varchar(128) NULL DEFAULT NULL,
			state varchar(32) NOT NULL DEFAULT 'RESERVED',
			lease_hash char(64) NULL DEFAULT NULL,
			lease_expires_at datetime NULL DEFAULT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY checkout_attempt_id (checkout_attempt_id),
			KEY state_updated (state, updated_at),
			KEY order_id (order_id)
		) {$charset_collate};";

		dbDelta( $attempts_sql );
		update_option( 'persi_headless_checkout_db_version', self::DATABASE_VERSION, false );
	}
}
