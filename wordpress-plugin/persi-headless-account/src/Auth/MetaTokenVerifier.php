<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

final class MetaTokenVerifier {
	public function verify( string $token, string $app_id, string $app_secret, string $graph_version ): ?array {
		$base = 'https://graph.facebook.com/' . rawurlencode( $graph_version );
		$debug_url = add_query_arg(
			array( 'input_token' => $token, 'access_token' => $app_id . '|' . $app_secret ),
			$base . '/debug_token'
		);
		$debug_response = wp_safe_remote_get( $debug_url, array( 'timeout' => 10, 'redirection' => 0 ) );
		if ( is_wp_error( $debug_response ) || 200 !== wp_remote_retrieve_response_code( $debug_response ) ) return null;
		$debug = json_decode( wp_remote_retrieve_body( $debug_response ), true );
		$data = is_array( $debug ) && is_array( $debug['data'] ?? null ) ? $debug['data'] : array();
		if ( true !== ( $data['is_valid'] ?? false ) || ! hash_equals( $app_id, (string) ( $data['app_id'] ?? '' ) ) ) return null;
		if ( ! is_numeric( $data['expires_at'] ?? null ) || (int) $data['expires_at'] <= time() || ! is_string( $data['user_id'] ?? null ) ) return null;

		$profile_url = add_query_arg( array( 'fields' => 'id,name,email,first_name,last_name,picture', 'access_token' => $token ), $base . '/me' );
		$profile_response = wp_safe_remote_get( $profile_url, array( 'timeout' => 10, 'redirection' => 0 ) );
		if ( is_wp_error( $profile_response ) || 200 !== wp_remote_retrieve_response_code( $profile_response ) ) return null;
		$profile = json_decode( wp_remote_retrieve_body( $profile_response ), true );
		if ( ! is_array( $profile ) || ! hash_equals( $data['user_id'], (string) ( $profile['id'] ?? '' ) ) || ! is_email( $profile['email'] ?? '' ) ) return null;
		return $profile;
	}
}
