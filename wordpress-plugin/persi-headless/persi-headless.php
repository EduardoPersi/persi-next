<?php
/**
 * Plugin Name: Persi Headless
 * Description: API pública e módulos de integração entre WooCommerce e o frontend headless da Persi.
 * Version: 0.5.2
 * Requires at least: 6.4
 * Requires PHP: 7.4
 * WC requires at least: 8.2
 * Text Domain: persi-headless
 */

defined( 'ABSPATH' ) || exit;

define( 'PERSI_HEADLESS_VERSION', '0.5.2' );
define( 'PERSI_HEADLESS_FILE', __FILE__ );
define( 'PERSI_HEADLESS_PATH', plugin_dir_path( __FILE__ ) );
define( 'PERSI_HEADLESS_URL', plugin_dir_url( __FILE__ ) );

require_once PERSI_HEADLESS_PATH . 'includes/class-activator.php';
require_once PERSI_HEADLESS_PATH . 'includes/class-deactivator.php';

register_activation_hook( __FILE__, array( 'Persi_Headless_Activator', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'Persi_Headless_Deactivator', 'deactivate' ) );

add_action(
	'plugins_loaded',
	static function () {
		require_once PERSI_HEADLESS_PATH . 'includes/class-plugin.php';
		Persi_Headless_Plugin::instance()->run();
	},
	20
);
