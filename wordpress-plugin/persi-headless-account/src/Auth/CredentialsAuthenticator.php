<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

final class CredentialsAuthenticator {
	public function authenticate( string $identifier, string $password ) {
		$user = wp_authenticate( $identifier, $password );
		if ( is_wp_error( $user ) || ! $user instanceof \WP_User ) {
			return null;
		}

		if ( ! self::is_allowed_user( $user ) ) {
			return null;
		}

		return $user;
	}

	public static function is_allowed_user( \WP_User $user ): bool {
		$allowed_roles = array( 'customer', 'subscriber' );
		return 0 === (int) $user->user_status &&
			! empty( array_intersect( $allowed_roles, (array) $user->roles ) );
	}
}
