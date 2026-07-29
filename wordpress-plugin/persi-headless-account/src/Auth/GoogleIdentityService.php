<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

final class GoogleIdentityService {
	private string $last_code = '';
	private bool $user_created = false;

	public function __construct(
		private readonly IdentityRepository $identities,
		private readonly string $secret
	) {}

	public function resolve( array $identity, ?int $now = null ): ?\WP_User {
		$this->last_code = '';
		$this->user_created = false;
		$subject_hash = hash_hmac(
			'sha256',
			'google|subject|' . $identity['subject'],
			$this->secret
		);
		$email_hash = hash_hmac(
			'sha256',
			'google|email|' . strtolower( $identity['email'] ),
			$this->secret
		);
		$locks = array( $email_hash, $subject_hash );
		sort( $locks );
		if ( ! $this->identities->acquire_locks( $locks ) ) {
			$this->last_code = 'ACCOUNT_GOOGLE_LOCK_FAILED';
			return null;
		}

		try {
			$linked = $this->identities->find_google( $subject_hash );
			if ( is_array( $linked ) ) {
				$user = get_user_by( 'id', (int) $linked['user_id'] );
				if (
					! $user instanceof \WP_User ||
					! CredentialsAuthenticator::is_allowed_user( $user )
				) {
					$this->last_code = 'ACCOUNT_GOOGLE_USER_REJECTED';
					return null;
				}
				$this->identities->touch(
					(int) $linked['id'],
					gmdate( 'Y-m-d H:i:s', $now ?? time() )
				);
				$this->last_code = 'ACCOUNT_GOOGLE_LINK_FOUND';
				return $user;
			}

			$user = get_user_by( 'email', $identity['email'] );
			if ( $user instanceof \WP_User ) {
				if ( ! CredentialsAuthenticator::is_allowed_user( $user ) ) {
					$this->last_code = 'ACCOUNT_GOOGLE_USER_REJECTED';
					return null;
				}
			} else {
				$user = $this->create_customer( $identity );
				if ( ! $user instanceof \WP_User ) {
					$this->last_code = 'ACCOUNT_GOOGLE_USER_CREATE_FAILED';
					return null;
				}
				$this->user_created = true;
			}

			$now_sql = gmdate( 'Y-m-d H:i:s', $now ?? time() );
			if (
				! $this->identities->create_google(
					(int) $user->ID,
					$subject_hash,
					$email_hash,
					$now_sql
				)
			) {
				$concurrent = $this->identities->find_google( $subject_hash );
				$concurrent_user = is_array( $concurrent )
					? get_user_by( 'id', (int) $concurrent['user_id'] )
					: false;
				if (
					! $concurrent_user instanceof \WP_User ||
					! CredentialsAuthenticator::is_allowed_user( $concurrent_user )
				) {
					$this->last_code = 'ACCOUNT_GOOGLE_LINK_CREATE_FAILED';
					return null;
				}
				$user = $concurrent_user;
				$this->user_created = false;
			}

			$this->last_code = 'ACCOUNT_GOOGLE_LINK_CREATED';
			return $user;
		} finally {
			$this->identities->release_locks( $locks );
		}
	}

	public function last_code(): string {
		return $this->last_code;
	}

	public function user_was_created(): bool {
		return $this->user_created;
	}

	private function create_customer( array $identity ): ?\WP_User {
		$base = sanitize_user( strstr( $identity['email'], '@', true ), true );
		$base = '' !== $base ? $base : 'cliente';
		$username = $base;
		$suffix = 1;
		while ( username_exists( $username ) ) {
			$username = $base . $suffix++;
		}

		$user_id = wp_insert_user(
			array(
				'user_login'   => $username,
				'user_email'   => $identity['email'],
				'user_pass'    => wp_generate_password( 32, true, true ),
				'display_name' => $identity['display_name'],
				'first_name'   => $identity['first_name'],
				'last_name'    => $identity['last_name'],
				'role'         => 'customer',
			)
		);
		if ( is_wp_error( $user_id ) ) {
			$existing = get_user_by( 'email', $identity['email'] );
			return $existing instanceof \WP_User &&
				CredentialsAuthenticator::is_allowed_user( $existing )
					? $existing
					: null;
		}
		$user = get_user_by( 'id', (int) $user_id );
		return $user instanceof \WP_User ? $user : null;
	}
}
