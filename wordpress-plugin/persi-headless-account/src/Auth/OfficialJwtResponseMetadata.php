<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

/** Expõe a expiração criada pelo emissor oficial sem decodificar ou alterar o JWT. */
final class OfficialJwtResponseMetadata {
	private ?int $expiration = null;

	public function register(): void {
		add_filter( 'jwt_auth_token_before_sign', array( $this, 'capture_expiration' ), PHP_INT_MAX, 2 );
		add_filter( 'jwt_auth_token_before_dispatch', array( $this, 'append_expiration' ), PHP_INT_MAX, 2 );
	}

	public function capture_expiration( array $payload, \WP_User $user ): array {
		unset( $user );
		$this->expiration = is_numeric( $payload['exp'] ?? null ) ? (int) $payload['exp'] : null;
		return $payload;
	}

	public function append_expiration( array $response, \WP_User $user ): array {
		unset( $user );
		if ( null !== $this->expiration ) $response['expires_at'] = gmdate( 'c', $this->expiration );
		$this->expiration = null;
		return $response;
	}
}
