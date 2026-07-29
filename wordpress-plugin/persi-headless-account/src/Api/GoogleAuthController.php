<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\GoogleIdentityService;
use Persi\HeadlessAccount\Auth\SessionService;
use Persi\HeadlessAccount\Security\AuthenticationException;
use Persi\HeadlessAccount\Security\ClientFingerprint;
use Persi\HeadlessAccount\Security\RateLimiter;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\Logger;
use Persi\HeadlessAccount\Support\Response;
use Persi\HeadlessAccount\Validation\GoogleLoginPayloadValidator;
use Persi\HeadlessAccount\Validation\ValidationException;

defined( 'ABSPATH' ) || exit;

final class GoogleAuthController {
	private const NAMESPACE = 'persi-account/v1';
	private const PATH = '/wp-json/persi-account/v1/google-login';

	public function __construct(
		private readonly RequestAuthenticator $request_authenticator,
		private readonly GoogleLoginPayloadValidator $validator,
		private readonly GoogleIdentityService $identities,
		private readonly SessionService $sessions,
		private readonly RateLimiter $rate_limiter,
		private readonly ClientFingerprint $fingerprint,
		private readonly Configuration $configuration,
		private readonly Logger $logger
	) {}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/google-login',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'login' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public function login( \WP_REST_Request $request ): \WP_REST_Response {
		$raw_body = $request->get_body();
		try {
			$auth = $this->request_authenticator->authenticate(
				'POST',
				self::PATH,
				$this->headers( $request ),
				$raw_body
			);
		} catch ( AuthenticationException $exception ) {
			$this->logger->write(
				'warning',
				'google_hmac_rejected',
				'ACCOUNT_GOOGLE_HMAC_REJECTED'
			);
			return Response::json( array( 'message' => 'Requisição não autorizada.' ), 401 );
		}
		if (
			strlen( $raw_body ) > Configuration::BODY_LIMIT_BYTES ||
			1 !== preg_match(
				'/^application\/json(?:\s*;|$)/',
				strtolower( trim( (string) $request->get_header( 'content-type' ) ) )
			)
		) {
			return Response::json( array( 'message' => 'Dados inválidos.' ), 400 );
		}
		try {
			$identity = $this->validator->validate( $raw_body );
		} catch ( ValidationException $exception ) {
			$this->logger->write(
				'warning',
				'google_payload_rejected',
				'ACCOUNT_GOOGLE_PAYLOAD_REJECTED',
				$auth->key_id
			);
			return Response::json( array( 'message' => 'Dados inválidos.' ), 400 );
		}

		$this->logger->write(
			'info',
			'google_email_received',
			'GOOGLE_EMAIL_RECEIVED',
			$auth->key_id
		);

		$buckets = $this->buckets( $identity );
		$retry_after = $this->rate_limiter->retry_after( $buckets );
		if ( $retry_after > 0 ) {
			return Response::json(
				array( 'message' => 'Não foi possível entrar com o Google.' ),
				429,
				$retry_after
			);
		}
		$user = $this->identities->resolve( $identity );
		if ( ! $user instanceof \WP_User ) {
			foreach ( $buckets as $bucket ) {
				$this->rate_limiter->record_failure( $bucket );
			}
			$this->logger->write(
				'warning',
				'google_identity_rejected',
				$this->identities->last_code(),
				$auth->key_id
			);
			return Response::json( array( 'message' => 'Não foi possível entrar com o Google.' ), 403 );
		}

		$user_created = $this->identities->user_was_created();
		$this->logger->write(
			'info',
			$user_created ? 'google_user_created' : 'google_user_found',
			$user_created ? 'GOOGLE_USER_CREATED' : 'GOOGLE_USER_FOUND',
			$auth->key_id
		);

		$session = $this->sessions->create(
			$user,
			false,
			$this->fingerprint->ip_hash( $_SERVER ),
			$this->fingerprint->user_agent_hash( $_SERVER )
		);
		if ( null === $session ) {
			$this->logger->write(
				'error',
				'google_session_failed',
				$this->sessions->last_code(),
				$auth->key_id
			);
			return Response::json( array( 'message' => 'Serviço indisponível.' ), 503 );
		}
		$this->rate_limiter->clear( $buckets );
		$this->logger->write(
			'info',
			'google_session_created',
			'GOOGLE_SESSION_CREATED',
			$auth->key_id
		);
		return Response::json(
			array(
				'authenticated' => true,
				'sessionToken' => $session['token'],
				'expiresAt'    => $session['expires_at'],
				'customer'     => $this->profile( $user ),
			)
		);
	}

	private function buckets( array $identity ): array {
		$ip_hash = $this->fingerprint->ip_hash( $_SERVER );
		return array_filter(
			array(
				$ip_hash
					? hash_hmac( 'sha256', 'google|ip|' . $ip_hash, $this->configuration->secret() )
					: null,
				hash_hmac( 'sha256', 'google|subject|' . $identity['subject'], $this->configuration->secret() ),
			)
		);
	}

	private function headers( \WP_REST_Request $request ): array {
		$headers = array();
		foreach ( array( 'x-persi-key-id', 'x-persi-timestamp', 'x-persi-nonce', 'x-persi-origin', 'x-persi-signature' ) as $name ) {
			$headers[ $name ] = (string) $request->get_header( $name );
		}
		return $headers;
	}

	private function profile( \WP_User $user ): array {
		$first_name = trim( (string) get_user_meta( $user->ID, 'first_name', true ) );
		return array(
			'firstName'   => $first_name,
			'displayName' => (string) $user->display_name,
			'email'       => (string) $user->user_email,
		);
	}
}
