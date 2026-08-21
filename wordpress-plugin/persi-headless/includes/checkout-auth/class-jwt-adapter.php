<?php

defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Checkout_Auth_Jwt_Adapter {
	public function issue( WP_User $user ): array {
		$username = 'persi-checkout-' . wp_generate_uuid4();
		$password = wp_generate_password( 64, true, true );
		$issued_user_id = 0;
		$expires_at = '';
		$authenticate = static function ( $authenticated, $candidate_username, $candidate_password ) use ( $user, $username, $password ) {
			return hash_equals( $username, (string) $candidate_username ) && hash_equals( $password, (string) $candidate_password ) ? $user : $authenticated;
		};
		$capture = static function ( array $payload ) use ( &$issued_user_id, &$expires_at ): array {
			$issued_user_id = (int) ( $payload['data']['user']['id'] ?? 0 );
			if ( isset( $payload['exp'] ) ) $expires_at = gmdate( 'c', (int) $payload['exp'] );
			return $payload;
		};
		add_filter( 'authenticate', $authenticate, 1, 3 );
		add_filter( 'jwt_auth_token_before_sign', $capture, PHP_INT_MAX, 1 );
		try {
			$request = new WP_REST_Request( 'POST', '/jwt-auth/v1/token' );
			$request->set_param( 'username', $username );
			$request->set_param( 'password', $password );
			$response = rest_do_request( $request );
		} finally {
			remove_filter( 'authenticate', $authenticate, 1 );
			remove_filter( 'jwt_auth_token_before_sign', $capture, PHP_INT_MAX );
		}
		if ( $response->is_error() ) throw new RuntimeException( 'jwt_issue_failed' );
		$data = $response->get_data();
		if ( ! is_array( $data ) || ! is_string( $data['token'] ?? null ) || $issued_user_id !== (int) $user->ID ) {
			throw new RuntimeException( 'jwt_response_invalid' );
		}
		$data['expires_at'] = is_string( $data['expires_at'] ?? null ) ? $data['expires_at'] : $expires_at;
		if ( '' === $data['expires_at'] ) throw new RuntimeException( 'jwt_expiration_missing' );
		return $data;
	}
}
