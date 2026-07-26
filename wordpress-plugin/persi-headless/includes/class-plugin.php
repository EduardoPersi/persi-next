<?php

defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Plugin {
	private static $instance;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function run() {
		require_once PERSI_HEADLESS_PATH . 'includes/class-settings.php';
		require_once PERSI_HEADLESS_PATH . 'includes/cache/class-cache.php';

		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( $this, 'woocommerce_notice' ) );
			return;
		}

		require_once PERSI_HEADLESS_PATH . 'includes/class-module-manager.php';
		( new Persi_Headless_Module_Manager() )->load();

		add_action( 'save_post_product', array( 'Persi_Headless_Cache', 'invalidate' ) );
		add_action( 'woocommerce_product_set_stock', array( 'Persi_Headless_Cache', 'invalidate' ) );
		add_action( 'woocommerce_variation_set_stock', array( 'Persi_Headless_Cache', 'invalidate' ) );

		if ( is_admin() ) {
			require_once PERSI_HEADLESS_PATH . 'includes/admin/class-admin.php';
			( new Persi_Headless_Admin() )->register();
		}
	}

	public function woocommerce_notice() {
		echo '<div class="notice notice-warning"><p>' .
			esc_html__( 'Persi Headless está inativo porque o WooCommerce não está disponível.', 'persi-headless' ) .
			'</p></div>';
	}
}
