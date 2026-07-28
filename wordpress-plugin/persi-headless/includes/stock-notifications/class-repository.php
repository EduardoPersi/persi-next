<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Stock_Repository {
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'persi_stock_notifications';
	}
	public static function nonce_table() { global $wpdb; return $wpdb->prefix . 'persi_stock_nonces'; }

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table = self::table();
		$charset = $wpdb->get_charset_collate();
		$sql = "CREATE TABLE {$table} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			product_id bigint(20) unsigned NOT NULL,
			variation_id bigint(20) unsigned NOT NULL DEFAULT 0,
			email_hash char(64) NOT NULL,
			email_encrypted longtext NOT NULL,
			status varchar(20) NOT NULL DEFAULT 'pending',
			confirmation_token char(64) DEFAULT NULL,
			unsubscribe_token char(64) NOT NULL,
			created_at datetime NOT NULL,
			confirmed_at datetime DEFAULT NULL,
			queued_at datetime DEFAULT NULL,
			sent_at datetime DEFAULT NULL,
			attempts smallint(5) unsigned NOT NULL DEFAULT 0,
			last_error text DEFAULT NULL,
			consent_given tinyint(1) NOT NULL DEFAULT 0,
			consent_at datetime DEFAULT NULL,
			privacy_policy_version varchar(64) DEFAULT NULL,
			privacy_policy_url varchar(255) DEFAULT NULL,
			consent_origin varchar(255) DEFAULT NULL,
			consent_ip_hash char(64) DEFAULT NULL,
			consent_user_agent_hash char(64) DEFAULT NULL,
			last_confirmation_sent_at datetime DEFAULT NULL,
			confirmation_attempts smallint(5) unsigned NOT NULL DEFAULT 0,
			last_notification_at datetime DEFAULT NULL,
			notification_cycle int unsigned NOT NULL DEFAULT 1,
			anonymized_at datetime DEFAULT NULL,
			expires_at datetime DEFAULT NULL,
			failure_code varchar(64) DEFAULT NULL,
			updated_at datetime DEFAULT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY subscription_cycle (product_id,variation_id,email_hash,notification_cycle),
			KEY product_id (product_id),
			KEY variation_id (variation_id),
			KEY status (status)
		) {$charset};";
		dbDelta( $sql );
		$nonce_sql = "CREATE TABLE " . self::nonce_table() . " (
			nonce_hash char(64) NOT NULL,
			expires_at datetime NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY (nonce_hash),
			KEY expires_at (expires_at)
		) {$charset};";
		dbDelta( $nonce_sql );
		$legacy = $wpdb->get_var( $wpdb->prepare( "SHOW INDEX FROM {$table} WHERE Key_name = %s", 'subscription' ) );
		if ( $legacy ) $wpdb->query( "ALTER TABLE {$table} DROP INDEX subscription" );
		$wpdb->query(
			"UPDATE {$table} SET expires_at = CASE
				WHEN status='pending' THEN DATE_ADD(created_at, INTERVAL 7 DAY)
				WHEN status='sent' THEN DATE_ADD(COALESCE(sent_at,created_at), INTERVAL 90 DAY)
				WHEN status IN ('failed','unsubscribed') THEN DATE_ADD(COALESCE(updated_at,created_at), INTERVAL 30 DAY)
				ELSE DATE_ADD(COALESCE(confirmed_at,created_at), INTERVAL 180 DAY)
			END, updated_at=COALESCE(updated_at,created_at)
			WHERE expires_at IS NULL"
		);
	}

	public static function claim_nonce( $hash, $expires ) {
		global $wpdb;
		$result = $wpdb->query( $wpdb->prepare( 'INSERT IGNORE INTO ' . self::nonce_table() . ' (nonce_hash,expires_at,created_at) VALUES (%s,%s,%s)', $hash, gmdate( 'Y-m-d H:i:s', $expires ), current_time( 'mysql', true ) ) );
		return 1 === $result;
	}

	public static function anonymize_expired() {
		global $wpdb;
		$now = current_time( 'mysql', true );
		return $wpdb->query( $wpdb->prepare(
			"UPDATE " . self::table() . " SET email_encrypted='', confirmation_token=NULL, unsubscribe_token='', status='anonymized', anonymized_at=%s, updated_at=%s
			WHERE anonymized_at IS NULL AND expires_at IS NOT NULL AND expires_at <= %s",
			$now, $now, $now
		) );
	}

	public static function encrypt_email( $email ) {
		if ( ! function_exists( 'openssl_encrypt' ) ) {
			return false;
		}
		$key = hash( 'sha256', wp_salt( 'auth' ), true );
		$iv  = random_bytes( 12 );
		$tag = '';
		$cipher = openssl_encrypt( $email, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag );
		return false === $cipher ? false : base64_encode( $iv . $tag . $cipher );
	}

	public static function decrypt_email( $value ) {
		$decoded = base64_decode( $value, true );
		if ( false === $decoded || strlen( $decoded ) < 29 || ! function_exists( 'openssl_decrypt' ) ) { return false; }
		$key = hash( 'sha256', wp_salt( 'auth' ), true );
		return openssl_decrypt( substr( $decoded, 28 ), 'aes-256-gcm', $key, OPENSSL_RAW_DATA, substr( $decoded, 0, 12 ), substr( $decoded, 12, 16 ) );
	}
}
