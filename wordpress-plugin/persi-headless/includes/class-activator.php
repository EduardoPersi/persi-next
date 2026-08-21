<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Activator {
	public static function activate() {
		if ( version_compare( PHP_VERSION, '7.4', '<' ) ) {
			deactivate_plugins( plugin_basename( PERSI_HEADLESS_FILE ) );
			wp_die( esc_html__( 'Persi Headless requer PHP 7.4 ou superior.', 'persi-headless' ) );
		}

		require_once PERSI_HEADLESS_PATH . 'includes/stock-notifications/class-repository.php';
		Persi_Headless_Stock_Repository::install();

		require_once PERSI_HEADLESS_PATH . 'includes/newsletter/class-repository.php';
		Persi_Headless_Newsletter_Repository::install();

		$defaults = array(
			'frontend_urls' => array( 'https://persimateriais.com.br' ),
			'modules'       => array(
				'product_families'   => true,
				'bought_together'    => true,
				'stock_notifications'=> true,
				'order_bump'         => false,
				'newsletter'         => true,
				'checkout_auth'      => true,
				'storefront_lockdown' => false,
			),
			'double_opt_in' => true,
			'batch_size'    => 25,
			'logging'       => false,
			'retention'     => array( 'pending' => 7, 'sent' => 90, 'failed' => 30, 'unsubscribed' => 30, 'confirmed' => 180 ),
		);

		if ( false === get_option( 'persi_headless_settings', false ) ) {
			add_option( 'persi_headless_settings', $defaults, '', false );
		}
		add_option( 'persi_headless_db_version', PERSI_HEADLESS_DATABASE_VERSION, '', false );
	}
}
