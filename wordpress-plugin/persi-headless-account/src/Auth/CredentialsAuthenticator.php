<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

final class CredentialsAuthenticator {
	private string $error_code = '';

	public function authenticate( string $identifier, string $password ) {
		$this->error_code = '';
		$user = wp_authenticate( $identifier, $password );
		if ( is_wp_error( $user ) || ! $user instanceof \WP_User ) {
			$this->error_code = 'ACCOUNT_LOGIN_CREDENTIALS_REJECTED';
			return null;
		}

		if ( ! self::is_allowed_user( $user ) ) {
			$this->error_code = 'ACCOUNT_LOGIN_ROLE_REJECTED';
			return null;
		}

		return $user;
	}

	public function error_code(): string {
		return $this->error_code;
	}

	public static function is_allowed_user( \WP_User $user ): bool {
		$allowed_roles = array( 'customer', 'subscriber' );
		return 0 === (int) $user->user_status &&
			! empty( array_intersect( $allowed_roles, (array) $user->roles ) );
	}
}
