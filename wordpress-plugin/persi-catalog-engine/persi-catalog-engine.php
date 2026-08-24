<?php
/**
 * Plugin Name: Persi Catalog Engine
 * Description: Sincroniza de forma auditável o GTIN do Olist ERP com o campo oficial do WooCommerce.
 * Version: 1.2.1
 * Requires at least: 7.0
 * Requires PHP: 8.1
 * WC requires at least: 9.1
 * Text Domain: persi-catalog-engine
 */

defined( 'ABSPATH' ) || exit;

define( 'PERSI_CATALOG_ENGINE_VERSION', '1.2.1' );
define( 'PERSI_CATALOG_ENGINE_FILE', __FILE__ );
define( 'PERSI_CATALOG_ENGINE_PATH', plugin_dir_path( __FILE__ ) );

require_once PERSI_CATALOG_ENGINE_PATH . 'src/Autoloader.php';

\Persi\CatalogEngine\Autoloader::register();

register_activation_hook( __FILE__, array( \Persi\CatalogEngine\Activator::class, 'activate' ) );

add_action(
	'plugins_loaded',
	static function (): void {
		\Persi\CatalogEngine\Plugin::boot();
	},
	20
);
