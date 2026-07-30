<?php

namespace Persi\HeadlessAccount\Auth;

use Persi\HeadlessAccount\Security\ClientFingerprint;
use Persi\HeadlessAccount\Security\RateLimiter;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\Logger;

defined( 'ABSPATH' ) || exit;

final class OAuthLoginService {
	public function __construct(
		private readonly OAuthIdentityService $identities,
		private readonly SessionService $sessions,
		private readonly RateLimiter $rate_limiter,
		private readonly ClientFingerprint $fingerprint,
		private readonly Configuration $configuration,
		private readonly Logger $logger
	) {}

	public function login( array $identity, string $key_id, array $server ): array {
		$provider = $identity['provider'];
		$this->logger->write(
			'info',
			'oauth_identity_received',
			'OAUTH_IDENTITY_RECEIVED',
			$key_id
		);

		$buckets = $this->buckets( $identity, $server );
		$retry_after = $this->rate_limiter->retry_after( $buckets );
		if ( $retry_after > 0 ) {
			return array(
				'status'      => 429,
				'retry_after' => $retry_after,
				'body'        => array( 'message' => $this->failure_message( $provider ) ),
			);
		}

		$user = $this->identities->resolve( $identity );
		if ( ! $user instanceof \WP_User ) {
			foreach ( $buckets as $bucket ) {
				$this->rate_limiter->record_failure( $bucket );
			}
			$this->logger->write(
				'warning',
				'oauth_identity_rejected',
				$this->identities->last_code(),
				$key_id
			);
			return array(
				'status' => 403,
				'body'   => array( 'message' => $this->failure_message( $provider ) ),
			);
		}

		$this->logger->write(
			'info',
			$this->identities->user_was_created()
				? 'oauth_user_created'
				: 'oauth_user_found',
			$this->identities->user_was_created()
				? 'OAUTH_USER_CREATED'
				: 'OAUTH_USER_FOUND',
			$key_id
		);

		$session = $this->sessions->create(
			$user,
			false,
			$this->fingerprint->ip_hash( $server ),
			$this->fingerprint->user_agent_hash( $server )
		);
		if ( null === $session ) {
			$this->logger->write(
				'error',
				'oauth_session_failed',
				$this->sessions->last_code(),
				$key_id
			);
			return array(
				'status' => 503,
				'body'   => array( 'message' => 'Serviço indisponível.' ),
			);
		}

		$this->rate_limiter->clear( $buckets );
		$this->logger->write(
			'info',
			'oauth_session_created',
			'OAUTH_SESSION_CREATED',
			$key_id
		);

		return array(
			'status' => 200,
			'body'   => array(
				'authenticated' => true,
				'sessionToken'  => $session['token'],
				'expiresAt'     => $session['expires_at'],
				'customer'      => $this->profile( $user ),
			),
		);
	}

	private function buckets( array $identity, array $server ): array {
		$ip_hash = $this->fingerprint->ip_hash( $server );
		return array_filter(
			array(
				$ip_hash
					? hash_hmac(
						'sha256',
						$identity['provider'] . '|ip|' . $ip_hash,
						$this->configuration->secret()
					)
					: null,
				hash_hmac(
					'sha256',
					$identity['provider'] . '|provider_id|' . $identity['provider_id'],
					$this->configuration->secret()
				),
			)
		);
	}

	private function failure_message( string $provider ): string {
		return 'Não foi possível entrar com o ' .
			( 'facebook' === $provider ? 'Facebook.' : 'Google.' );
	}

	private function profile( \WP_User $user ): array {
		return array(
			'firstName'   => trim( (string) get_user_meta( $user->ID, 'first_name', true ) ),
			'displayName' => (string) $user->display_name,
			'email'       => (string) $user->user_email,
		);
	}
}
