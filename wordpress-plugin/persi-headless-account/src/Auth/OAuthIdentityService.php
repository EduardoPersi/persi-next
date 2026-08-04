<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

class OAuthIdentityService {
	private string $last_code = '';
	private bool $user_created = false;

	public function __construct( private readonly IdentityRepository $identities ) {}

	public function resolve( array $identity, ?int $now = null ): ?\WP_User {
		$this->last_code = '';
		$this->user_created = false;
		$provider = $identity['provider'];
		$salt = wp_salt( 'auth' );
		$provider_id_hash = hash( 'sha256', $salt . '|' . $provider . '|provider_id|' . $identity['provider_id'] );
		$email_hash = hash( 'sha256', $salt . '|oauth|email|' . strtolower( $identity['email'] ) );
		$locks = array( $email_hash, $provider_id_hash );
		sort( $locks );
		if ( ! $this->identities->acquire_locks( $locks ) ) {
			$this->last_code = $this->code( 'LOCK_FAILED', $provider );
			return null;
		}

		try {
			$linked = $this->identities->find( $provider, $provider_id_hash );
			if ( is_array( $linked ) ) {
				if ( ! hash_equals( (string) $linked['email_hash'], $email_hash ) ) {
					$this->last_code = $this->code( 'IDENTITY_CONFLICT', $provider );
					return null;
				}
				$user = get_user_by( 'id', (int) $linked['user_id'] );
				if (
					! $user instanceof \WP_User ||
					! CredentialsAuthenticator::is_allowed_user( $user ) ||
					! $this->email_matches( $user, $identity['email'] )
				) {
					$this->last_code = $this->code( 'USER_REJECTED', $provider );
					return null;
				}
				$this->identities->touch(
					(int) $linked['id'],
					gmdate( 'Y-m-d H:i:s', $now ?? time() )
				);
				$this->last_code = $this->code( 'LINK_FOUND', $provider );
				return $user;
			}

			$user = get_user_by( 'email', $identity['email'] );
			if ( $user instanceof \WP_User ) {
				if ( ! CredentialsAuthenticator::is_allowed_user( $user ) ) {
					$this->last_code = $this->code( 'USER_REJECTED', $provider );
					return null;
				}
			} else {
				$user = $this->create_customer( $identity );
				if ( ! $user instanceof \WP_User ) {
					$this->last_code = $this->code( 'USER_CREATE_FAILED', $provider );
					return null;
				}
				$this->user_created = true;
			}

			$now_sql = gmdate( 'Y-m-d H:i:s', $now ?? time() );
			if (
				! $this->identities->create(
					(int) $user->ID,
					$provider,
					$provider_id_hash,
					$email_hash,
					$now_sql
				)
			) {
				$concurrent = $this->identities->find( $provider, $provider_id_hash );
				$concurrent_user = is_array( $concurrent )
					? get_user_by( 'id', (int) $concurrent['user_id'] )
					: false;
				if (
					! $concurrent_user instanceof \WP_User ||
					! hash_equals( (string) ( $concurrent['email_hash'] ?? '' ), $email_hash ) ||
					! CredentialsAuthenticator::is_allowed_user( $concurrent_user ) ||
					! $this->email_matches( $concurrent_user, $identity['email'] )
				) {
					$this->last_code = $this->code( 'LINK_CREATE_FAILED', $provider );
					return null;
				}
				$user = $concurrent_user;
				$this->user_created = false;
			}

			$this->last_code = $this->code( 'LINK_CREATED', $provider );
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

	private function email_matches( \WP_User $user, string $verified_email ): bool {
		return hash_equals(
			strtolower( trim( (string) $user->user_email ) ),
			strtolower( trim( $verified_email ) )
		);
	}

	private function code( string $suffix, string $provider ): string {
		return 'ACCOUNT_' . strtoupper( $provider ) . '_' . $suffix;
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
				'display_name' => $identity['name'],
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
