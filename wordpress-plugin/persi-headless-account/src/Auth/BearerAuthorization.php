<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

final class BearerAuthorization {
	public function user( \WP_REST_Request $request ) {
		$authorization = trim( (string) $request->get_header( 'authorization' ) );
		if ( 1 !== preg_match( '/^Bearer\s+[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/', $authorization ) ) {
			return new \WP_Error( 'persi_jwt_missing', 'Autenticação necessária.', array( 'status' => 401 ) );
		}

		$user = wp_get_current_user();
		if ( ! $user instanceof \WP_User || $user->ID <= 0 || ! CredentialsAuthenticator::is_allowed_user( $user ) ) {
			return new \WP_Error( 'persi_jwt_invalid', 'JWT inválido ou expirado.', array( 'status' => 401 ) );
		}

		return $user;
	}
}
