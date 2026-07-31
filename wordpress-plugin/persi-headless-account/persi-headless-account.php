<?php
/**
 * Plugin Name: Persi Headless Account
 * Description: Autenticação e sessões opacas para a área da conta headless da Persi.
 * Version: 0.5.0
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * WC requires at least: 8.2
 * Text Domain: persi-headless-account
 */

defined( 'ABSPATH' ) || exit;

define( 'PERSI_HEADLESS_ACCOUNT_VERSION', '0.5.0' );
define( 'PERSI_HEADLESS_ACCOUNT_FILE', __FILE__ );
define( 'PERSI_HEADLESS_ACCOUNT_PATH', plugin_dir_path( __FILE__ ) );

require_once PERSI_HEADLESS_ACCOUNT_PATH . 'src/Autoloader.php';

\Persi\HeadlessAccount\Autoloader::register();

register_activation_hook(
	__FILE__,
	array( \Persi\HeadlessAccount\Activator::class, 'activate' )
);

add_action(
	'before_woocommerce_init',
	static function (): void {
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
	static function (): void {
		\Persi\HeadlessAccount\Plugin::boot();
	},
	20
);
