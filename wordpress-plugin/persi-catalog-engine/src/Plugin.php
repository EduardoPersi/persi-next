<?php

namespace Persi\CatalogEngine;

use Persi\CatalogEngine\Admin\AdminPage;
use Persi\CatalogEngine\Admin\OlistDiagnosticPage;
use Persi\CatalogEngine\Admin\AttributesPage;
use Persi\CatalogEngine\Catalog\BatchProcessor;

defined( 'ABSPATH' ) || exit;

final class Plugin {
	public static function boot(): void {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( self::class, 'woocommerce_notice' ) );
			return;
		}

		if ( ! method_exists( 'WC_Product', 'set_global_unique_id' ) ) {
			add_action( 'admin_notices', array( self::class, 'version_notice' ) );
			return;
		}

		Activator::maybe_upgrade();

		$processor = new BatchProcessor();
		$processor->register();

		if ( is_admin() ) {
			( new AdminPage( $processor ) )->register();
			( new OlistDiagnosticPage() )->register();
			( new AttributesPage() )->register();
		}
	}

	public static function woocommerce_notice(): void {
		echo '<div class="notice notice-error"><p>' . esc_html__( 'Persi Catalog Engine requer WooCommerce ativo.', 'persi-catalog-engine' ) . '</p></div>';
	}

	public static function version_notice(): void {
		echo '<div class="notice notice-error"><p>' . esc_html__( 'Persi Catalog Engine requer suporte oficial a global_unique_id (WooCommerce 9.1+).', 'persi-catalog-engine' ) . '</p></div>';
	}
}
