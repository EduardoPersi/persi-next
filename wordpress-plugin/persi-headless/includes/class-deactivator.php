<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Deactivator {
	public static function deactivate() {
		wp_clear_scheduled_hook( 'persi_headless_cleanup_rate_limits' );
	}
}
