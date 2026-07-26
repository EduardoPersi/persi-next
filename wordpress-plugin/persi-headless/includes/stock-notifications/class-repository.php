<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Stock_Repository {
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'persi_stock_notifications';
	}

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
			PRIMARY KEY  (id),
			UNIQUE KEY subscription (product_id,variation_id,email_hash),
			KEY product_id (product_id),
			KEY variation_id (variation_id),
			KEY status (status)
		) {$charset};";
		dbDelta( $sql );
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
