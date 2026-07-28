<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Deactivator {
	public static function deactivate() {
		wp_clear_scheduled_hook( 'persi_headless_cleanup_rate_limits' );
		wp_clear_scheduled_hook( 'persi_headless_cleanup_stock_notifications' );
		if ( function_exists( 'as_unschedule_all_actions' ) ) {
			as_unschedule_all_actions( 'persi_headless_cleanup_stock_notifications', array(), 'persi-headless-stock-notifications' );
		}
	}
}
