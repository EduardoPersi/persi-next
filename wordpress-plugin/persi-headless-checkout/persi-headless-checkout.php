<?php
/**
 * Plugin Name: Persi Headless Checkout
 * Description: Núcleo seguro para transferências temporárias de checkout headless.
 * Version: 0.3.0
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * WC requires at least: 8.2
 * Text Domain: persi-headless-checkout
 */

defined( 'ABSPATH' ) || exit;

define( 'PERSI_HEADLESS_CHECKOUT_VERSION', '0.3.0' );
define( 'PERSI_HEADLESS_CHECKOUT_FILE', __FILE__ );
define( 'PERSI_HEADLESS_CHECKOUT_PATH', plugin_dir_path( __FILE__ ) );

require_once PERSI_HEADLESS_CHECKOUT_PATH . 'src/Autoloader.php';

\Persi\HeadlessCheckout\Autoloader::register();

register_activation_hook(
	__FILE__,
	array( \Persi\HeadlessCheckout\Activator::class, 'activate' )
);

add_action(
	'before_woocommerce_init',
	static function () {
		if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility(
				'custom_order_tables',
				__FILE__,
				true
			);
		}
	}
);

add_action(
	'plugins_loaded',
	static function () {
		\Persi\HeadlessCheckout\Plugin::boot();
	},
	20
);
