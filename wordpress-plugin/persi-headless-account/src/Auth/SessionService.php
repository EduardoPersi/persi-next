<?php

namespace Persi\HeadlessAccount\Auth;

use Persi\HeadlessAccount\Support\Configuration;

defined( 'ABSPATH' ) || exit;

final class SessionService {
	public function __construct(
		private readonly SessionRepository $repository,
		private readonly SessionToken $tokens
	) {}

	public function create(
		\WP_User $user,
		bool $remember,
		?string $ip_hash,
		?string $user_agent_hash,
		?int $now = null
	): ?array {
		$now      = $now ?? time();
		$idle     = $remember
			? Configuration::REMEMBER_IDLE_SECONDS
			: Configuration::IDLE_SECONDS;
		$absolute = $remember
			? Configuration::REMEMBER_ABSOLUTE_SECONDS
			: Configuration::ABSOLUTE_SECONDS;
		$token    = $this->tokens->generate();
		$expires  = $now + $absolute;

		$created = $this->repository->create(
			array(
				'token_hash'          => $this->tokens->hash( $token ),
				'user_id'             => (int) $user->ID,
				'created_at'          => gmdate( 'Y-m-d H:i:s', $now ),
				'idle_expires_at'     => gmdate( 'Y-m-d H:i:s', min( $expires, $now + $idle ) ),
				'absolute_expires_at' => gmdate( 'Y-m-d H:i:s', $expires ),
				'rotation_parent_hash'=> null,
				'user_agent_hash'     => $user_agent_hash,
				'ip_hash'             => $ip_hash,
			)
		);

		return $created
			? array(
				'token'      => $token,
				'expires_at' => gmdate( 'c', $expires ),
			)
			: null;
	}

	public function resolve( string $token, ?int $now = null ): ?array {
		if ( ! $this->tokens->is_valid( $token ) ) {
			return null;
		}

		$now        = $now ?? time();
		$now_sql    = gmdate( 'Y-m-d H:i:s', $now );
		$token_hash = $this->tokens->hash( $token );
		$record     = $this->repository->find_active( $token_hash );
		if ( null === $record ) {
			return null;
		}

		$idle     = strtotime( $record['idle_expires_at'] . ' UTC' );
		$absolute = strtotime( $record['absolute_expires_at'] . ' UTC' );
		if ( false === $idle || false === $absolute || $idle <= $now || $absolute <= $now ) {
			$this->repository->expire(
				(int) $record['id'],
				$absolute <= $now ? 'absolute_expired' : 'idle_expired',
				$now_sql
			);
			return null;
		}

		$user = get_user_by( 'id', (int) $record['user_id'] );
		if (
			! $user instanceof \WP_User ||
			! CredentialsAuthenticator::is_allowed_user( $user )
		) {
			$this->repository->expire( (int) $record['id'], 'user_unavailable', $now_sql );
			return null;
		}

		$remaining = max( 1, $absolute - $now );
		$created   = strtotime( $record['created_at'] . ' UTC' );
		$remember  = false !== $created &&
			$absolute - $created > Configuration::ABSOLUTE_SECONDS;
		$idle_ttl  = min(
			$remember
				? Configuration::REMEMBER_IDLE_SECONDS
				: Configuration::IDLE_SECONDS,
			$remaining
		);

		$next_idle = gmdate( 'Y-m-d H:i:s', $now + $idle_ttl );
		if (
			! $this->repository->touch(
				(int) $record['id'],
				$token_hash,
				$now_sql,
				$next_idle
			)
		) {
			return null;
		}

		return array(
			'user'       => $user,
			'expires_at' => gmdate( 'c', $absolute ),
		);
	}

	public function logout( string $token, ?int $now = null ): void {
		if ( ! $this->tokens->is_valid( $token ) ) {
			return;
		}
		$this->repository->revoke(
			$this->tokens->hash( $token ),
			gmdate( 'Y-m-d H:i:s', $now ?? time() )
		);
	}
}
