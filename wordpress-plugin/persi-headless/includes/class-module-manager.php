<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Module_Manager {
	public function load() {
		$modules = array(
			'product_families'    => 'product-families/class-product-families.php',
			'bought_together'     => 'bought-together/class-bought-together.php',
			'stock_notifications' => 'stock-notifications/class-stock-notifications.php',
			'order_bump'          => 'order-bump/class-order-bump.php',
			'newsletter'          => 'newsletter/class-newsletter.php',
		);

		foreach ( $modules as $key => $file ) {
			if ( Persi_Headless_Settings::module_enabled( $key ) ) {
				require_once PERSI_HEADLESS_PATH . 'includes/' . $file;
				$class = 'Persi_Headless_' . str_replace( ' ', '_', ucwords( str_replace( '_', ' ', $key ) ) );
				if ( class_exists( $class ) ) {
					( new $class() )->register();
				}
			}
		}
	}
}
