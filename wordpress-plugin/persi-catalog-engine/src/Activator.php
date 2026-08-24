<?php

namespace Persi\CatalogEngine;

defined( 'ABSPATH' ) || exit;

final class Activator {
	public const DATABASE_VERSION = '10';

	public static function activate(): void {
		if ( ! class_exists( 'WooCommerce' ) || ! method_exists( 'WC_Product', 'set_global_unique_id' ) ) {
			deactivate_plugins( plugin_basename( PERSI_CATALOG_ENGINE_FILE ) );
			wp_die( esc_html__( 'Persi Catalog Engine requer WooCommerce 9.1 ou superior.', 'persi-catalog-engine' ) );
		}

		self::install_schema();
	}

	public static function maybe_upgrade(): void {
		if ( self::DATABASE_VERSION !== (string) get_option( 'persi_catalog_engine_db_version', '' ) ) {
			self::install_schema();
		}
	}

	private static function install_schema(): void {
		global $wpdb;

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$collate = $wpdb->get_charset_collate();
		$runs    = $wpdb->prefix . 'persi_catalog_runs';
		$logs    = $wpdb->prefix . 'persi_catalog_logs';
		$items   = $wpdb->prefix . 'persi_catalog_run_items';
		$candidates = $wpdb->prefix . 'persi_catalog_attribute_candidates';
		$mappings   = $wpdb->prefix . 'persi_catalog_attribute_mappings';
		$aliases    = $wpdb->prefix . 'persi_catalog_attribute_aliases';
		$cache      = $wpdb->prefix . 'persi_catalog_olist_cache';

		dbDelta( "CREATE TABLE {$runs} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			mode varchar(12) NOT NULL,
			modules varchar(191) NOT NULL DEFAULT 'gtin',
			scope varchar(24) NOT NULL DEFAULT 'missing-unchecked',
			status varchar(20) NOT NULL DEFAULT 'pending',
			requested_limit int(10) unsigned NOT NULL DEFAULT 10,
			cursor_id bigint(20) unsigned NOT NULL DEFAULT 0,
			processed int(10) unsigned NOT NULL DEFAULT 0,
			total_items int(10) unsigned NOT NULL DEFAULT 0,
			current_product_id bigint(20) unsigned NOT NULL DEFAULT 0,
			current_product_name text NULL DEFAULT NULL,
			current_sku varchar(191) NOT NULL DEFAULT '',
			current_stage varchar(32) NOT NULL DEFAULT 'QUEUE_PREPARING',
			current_message varchar(191) NOT NULL DEFAULT '',
			performance_metrics longtext NULL DEFAULT NULL,
			failure_stage varchar(32) NOT NULL DEFAULT '',
			failure_code varchar(64) NOT NULL DEFAULT '',
			failure_message varchar(191) NOT NULL DEFAULT '',
			counters longtext NOT NULL,
			created_by bigint(20) unsigned NOT NULL,
			created_at datetime NOT NULL,
			started_at datetime NULL DEFAULT NULL,
			finished_at datetime NULL DEFAULT NULL,
			updated_at datetime NULL DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY status_created (status, created_at)
		) {$collate};" );

		dbDelta( "CREATE TABLE {$cache} (
			sku varchar(191) NOT NULL,
			olist_product_id bigint(20) unsigned NOT NULL,
			snapshot longtext NOT NULL,
			fetched_at datetime NOT NULL,
			expires_at datetime NOT NULL,
			PRIMARY KEY  (sku),
			KEY olist_product_id (olist_product_id),
			KEY expires_at (expires_at)
		) {$collate};" );

		dbDelta( "CREATE TABLE {$candidates} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			run_id bigint(20) unsigned NOT NULL,
			product_id bigint(20) unsigned NOT NULL,
			parent_product_id bigint(20) unsigned NOT NULL DEFAULT 0,
			sku varchar(191) NOT NULL DEFAULT '',
			category_path text NULL DEFAULT NULL,
			family varchar(64) NOT NULL DEFAULT 'generic',
			module varchar(24) NOT NULL DEFAULT 'attributes',
			attribute_key varchar(64) NOT NULL,
			woo_taxonomy varchar(64) NOT NULL DEFAULT '',
			old_value text NULL DEFAULT NULL,
			raw_value text NOT NULL,
			normalized_value text NOT NULL,
			display_value text NULL DEFAULT NULL,
			numeric_value decimal(20,6) NULL DEFAULT NULL,
			unit varchar(24) NOT NULL DEFAULT '',
			unit_source varchar(40) NOT NULL DEFAULT '',
			components longtext NULL DEFAULT NULL,
			search_aliases longtext NULL DEFAULT NULL,
			source varchar(32) NOT NULL,
			source_field varchar(191) NOT NULL DEFAULT '',
			evidence text NULL DEFAULT NULL,
			existing_term varchar(191) NOT NULL DEFAULT '',
			rule_id varchar(64) NOT NULL DEFAULT '',
			ruleset_version varchar(24) NOT NULL DEFAULT '',
			confidence varchar(24) NOT NULL,
			status varchar(40) NOT NULL,
			created_at datetime NOT NULL,
			updated_at datetime NULL DEFAULT NULL,
			approved_by bigint(20) unsigned NULL DEFAULT NULL,
			approved_at datetime NULL DEFAULT NULL,
			PRIMARY KEY  (id),
			KEY run_product (run_id, product_id),
			KEY status (status),
			KEY attribute_key (attribute_key),
			KEY run_family (run_id, family),
			KEY run_source (run_id, source)
		) {$collate};" );

		dbDelta( "CREATE TABLE {$mappings} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			origin_key varchar(191) NOT NULL,
			category_id bigint(20) unsigned NOT NULL DEFAULT 0,
			family varchar(64) NOT NULL DEFAULT '',
			attribute_key varchar(64) NOT NULL,
			woo_taxonomy varchar(64) NOT NULL,
			normalizer varchar(64) NOT NULL DEFAULT '',
			is_active tinyint(1) unsigned NOT NULL DEFAULT 1,
			auto_write tinyint(1) unsigned NOT NULL DEFAULT 0,
			created_by bigint(20) unsigned NOT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY origin_family_category (origin_key, family, category_id),
			KEY woo_taxonomy (woo_taxonomy)
		) {$collate};" );
		$legacy_mapping_index = $wpdb->get_var( "SHOW INDEX FROM {$mappings} WHERE Key_name='origin_category'" );
		if ( $legacy_mapping_index ) { $wpdb->query( "ALTER TABLE {$mappings} DROP INDEX origin_category" ); }

		dbDelta( "CREATE TABLE {$aliases} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			concept varchar(64) NOT NULL,
			source_value varchar(191) NOT NULL,
			canonical_value varchar(191) NOT NULL,
			target_term varchar(191) NOT NULL DEFAULT '',
			status varchar(24) NOT NULL DEFAULT 'pending',
			created_at datetime NOT NULL,
			updated_at datetime NOT NULL,
			PRIMARY KEY  (id),
			UNIQUE KEY concept_source (concept,source_value),
			KEY status (status)
		) {$collate};" );

		dbDelta( "CREATE TABLE {$items} (
			run_id bigint(20) unsigned NOT NULL,
			product_id bigint(20) unsigned NOT NULL,
			parent_product_id bigint(20) unsigned NOT NULL DEFAULT 0,
			target_type varchar(16) NOT NULL DEFAULT 'product',
			modules varchar(191) NOT NULL DEFAULT 'gtin',
			PRIMARY KEY  (run_id, product_id),
			KEY product_id (product_id)
		) {$collate};" );

		dbDelta( "CREATE TABLE {$logs} (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			run_id bigint(20) unsigned NOT NULL,
			product_id bigint(20) unsigned NOT NULL,
			product_name text NOT NULL,
			sku varchar(191) NOT NULL,
			status varchar(32) NOT NULL,
			field_name varchar(64) NOT NULL DEFAULT 'global_unique_id',
			source varchar(64) NOT NULL DEFAULT 'Olist ERP',
			old_value varchar(32) NOT NULL DEFAULT '',
			new_value varchar(32) NOT NULL DEFAULT '',
			olist_product_id bigint(20) unsigned NULL DEFAULT NULL,
			details text NULL DEFAULT NULL,
			created_at datetime NOT NULL,
			PRIMARY KEY  (id),
			KEY run_status (run_id, status),
			KEY product_id (product_id),
			KEY product_status (product_id, status),
			KEY sku (sku)
		) {$collate};" );

		if ( self::schema_ready() ) {
			update_option( 'persi_catalog_engine_db_version', self::DATABASE_VERSION, false );
		}
	}

	public static function schema_ready(): bool {
		global $wpdb;
		$runs = $wpdb->prefix . 'persi_catalog_runs';
		$items = $wpdb->prefix . 'persi_catalog_run_items';
		$cache = $wpdb->prefix . 'persi_catalog_olist_cache';
		$aliases = $wpdb->prefix . 'persi_catalog_attribute_aliases';
		$candidates = $wpdb->prefix . 'persi_catalog_attribute_candidates';
		return (bool) $wpdb->get_var( $wpdb->prepare( "SHOW COLUMNS FROM {$runs} LIKE %s", 'performance_metrics' ) )
			&& (bool) $wpdb->get_var( $wpdb->prepare( "SHOW TABLES LIKE %s", $items ) )
			&& (bool) $wpdb->get_var( $wpdb->prepare( "SHOW TABLES LIKE %s", $cache ) )
			&& (bool) $wpdb->get_var( $wpdb->prepare( "SHOW TABLES LIKE %s", $aliases ) )
			&& (bool) $wpdb->get_var( $wpdb->prepare( "SHOW COLUMNS FROM {$candidates} LIKE %s", 'search_aliases' ) );
	}
}
