<?php

defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Checkout_Auth_Rate_Limiter {
	public function consume( string $scope, string $identity, int $limit, int $window ): int {
		$key = 'persi_checkout_auth_rate_' . hash_hmac( 'sha256', $scope . '|' . strtolower( $identity ), wp_salt( 'nonce' ) );
		$entry = get_transient( $key );
		$now = time();
		if ( ! is_array( $entry ) || (int) ( $entry['expires'] ?? 0 ) <= $now ) {
			$entry = array( 'count' => 0, 'expires' => $now + $window );
		}
		if ( (int) $entry['count'] >= $limit ) return max( 1, (int) $entry['expires'] - $now );
		$entry['count'] = (int) $entry['count'] + 1;
		set_transient( $key, $entry, max( 1, (int) $entry['expires'] - $now ) );
		return 0;
	}

	public function fingerprint( WP_REST_Request $request ): string {
		$ip = (string) ( $_SERVER['REMOTE_ADDR'] ?? '' );
		return hash_hmac( 'sha256', $ip . '|' . (string) $request->get_header( 'user-agent' ), wp_salt( 'auth' ) );
	}
}
