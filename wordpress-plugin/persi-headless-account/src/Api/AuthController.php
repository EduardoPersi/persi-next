<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\CredentialsAuthenticator;
use Persi\HeadlessAccount\Auth\SessionService;
use Persi\HeadlessAccount\Security\AuthenticationException;
use Persi\HeadlessAccount\Security\ClientFingerprint;
use Persi\HeadlessAccount\Security\RateLimiter;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\Logger;
use Persi\HeadlessAccount\Support\Response;
use Persi\HeadlessAccount\Validation\LoginPayloadValidator;
use Persi\HeadlessAccount\Validation\ValidationException;

defined( 'ABSPATH' ) || exit;

final class AuthController {
	private const NAMESPACE = 'persi-account/v1';
	private const BASE_PATH = '/wp-json/persi-account/v1';

	public function __construct(
		private readonly RequestAuthenticator $request_authenticator,
		private readonly CredentialsAuthenticator $credentials,
		private readonly SessionService $sessions,
		private readonly RateLimiter $rate_limiter,
		private readonly ClientFingerprint $fingerprint,
		private readonly LoginPayloadValidator $validator,
		private readonly Configuration $configuration,
		private readonly Logger $logger
	) {}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/login',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'login' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/session',
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( $this, 'session' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			self::NAMESPACE,
			'/logout',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'logout' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public function login( \WP_REST_Request $request ): \WP_REST_Response {
		$raw_body = $request->get_body();
		$auth     = $this->authenticate_request( $request, '/login', $raw_body );
		if ( $auth instanceof \WP_REST_Response ) {
			return $auth;
		}

		if (
			strlen( $raw_body ) > Configuration::BODY_LIMIT_BYTES ||
			! $this->is_json( $request )
		) {
			return Response::json( array( 'message' => 'Dados inválidos.' ), 400 );
		}

		try {
			$input = $this->validator->validate( $raw_body );
		} catch ( ValidationException $exception ) {
			return Response::json( array( 'message' => 'Dados inválidos.' ), 400 );
		}

		$ip_hash         = $this->fingerprint->ip_hash( $_SERVER );
		$identifier_hash = hash_hmac(
			'sha256',
			'identifier|' . strtolower( $input['identifier'] ),
			$this->configuration->secret()
		);
		$buckets = array_filter(
			array(
				$ip_hash ? hash_hmac( 'sha256', 'login|' . $ip_hash, $this->configuration->secret() ) : null,
				$identifier_hash,
			)
		);
		$retry_after = $this->rate_limiter->retry_after( $buckets );
		if ( $retry_after > 0 ) {
			$this->logger->write( 'warning', 'login_rate_limited', 'rate_limit', $auth->key_id );
			return Response::json(
				array( 'message' => 'Não foi possível entrar com os dados informados.' ),
				429,
				$retry_after
			);
		}

		$user = $this->credentials->authenticate(
			$input['identifier'],
			$input['password']
		);
		if ( ! $user instanceof \WP_User ) {
			$retry_after = 0;
			foreach ( $buckets as $bucket ) {
				$retry_after = max(
					$retry_after,
					$this->rate_limiter->record_failure( $bucket )
				);
			}
			$this->logger->write(
				'warning',
				'login_rejected',
				$this->credentials->error_code(),
				$auth->key_id
			);
			return Response::json(
				array( 'message' => 'Não foi possível entrar com os dados informados.' ),
				$retry_after > 0 ? 429 : 401,
				$retry_after > 0 ? $retry_after : null
			);
		}

		$this->rate_limiter->clear( $buckets );
		$session = $this->sessions->create(
			$user,
			$input['remember'],
			$ip_hash,
			$this->fingerprint->user_agent_hash( $_SERVER )
		);
		if ( null === $session ) {
			$this->logger->write(
				'error',
				'session_storage_failed',
				$this->sessions->last_code(),
				$auth->key_id
			);
			return Response::json(
				array( 'message' => 'Serviço indisponível.' ),
				503
			);
		}

		$this->logger->write( 'info', 'session_created', 'success', $auth->key_id );
		return Response::json(
			array(
				'authenticated' => true,
				'sessionToken' => $session['token'],
				'expiresAt'    => $session['expires_at'],
				'customer'     => $this->profile( $user ),
			)
		);
	}

	public function session( \WP_REST_Request $request ): \WP_REST_Response {
		$raw_body = $request->get_body();
		$auth     = $this->authenticate_request( $request, '/session', $raw_body );
		if ( $auth instanceof \WP_REST_Response ) {
			return $auth;
		}
		if ( '' !== $raw_body ) {
			return Response::json( array( 'authenticated' => false ), 400 );
		}

		$result = $this->sessions->resolve(
			trim( (string) $request->get_header( 'x-persi-session' ) )
		);
		if ( null === $result ) {
			$this->logger->write(
				'info',
				'session_invalid',
				$this->sessions->last_code(),
				$auth->key_id
			);
			return Response::json( array( 'authenticated' => false ) );
		}

		$this->logger->write(
			'info',
			'session_valid',
			$this->sessions->last_code(),
			$auth->key_id
		);
		return Response::json(
			array(
				'authenticated' => true,
				'expiresAt'    => $result['expires_at'],
				'customer'     => $this->profile( $result['user'] ),
			)
		);
	}

	public function logout( \WP_REST_Request $request ): \WP_REST_Response {
		$raw_body = $request->get_body();
		$auth     = $this->authenticate_request( $request, '/logout', $raw_body );
		if ( $auth instanceof \WP_REST_Response ) {
			return $auth;
		}
		if (
			strlen( $raw_body ) > Configuration::BODY_LIMIT_BYTES ||
			'' !== $raw_body
		) {
			return Response::json( array( 'authenticated' => false ), 400 );
		}

		$this->sessions->logout(
			trim( (string) $request->get_header( 'x-persi-session' ) )
		);
		$this->logger->write( 'info', 'session_revoked', 'logout', $auth->key_id );
		return Response::json( array( 'authenticated' => false ) );
	}

	private function authenticate_request(
		\WP_REST_Request $request,
		string $route,
		string $raw_body
	) {
		try {
			return $this->request_authenticator->authenticate(
				$request->get_method(),
				self::BASE_PATH . $route,
				$this->headers( $request ),
				$raw_body
			);
		} catch ( AuthenticationException $exception ) {
			$code   = $exception->error_code();
			$status = 'service_unavailable' === $code ? 503 : ( 'replay' === $code ? 409 : 401 );
			$this->logger->write(
				'warning',
				'replay' === $code ? 'nonce_replay_rejected' : 'hmac_rejected',
				'replay' === $code
					? 'ACCOUNT_LOGIN_REPLAY_REJECTED'
					: 'ACCOUNT_LOGIN_HMAC_REJECTED'
			);
			return Response::json( array( 'message' => 'Requisição não autorizada.' ), $status );
		}
	}

	private function headers( \WP_REST_Request $request ): array {
		$names = array(
			'x-persi-key-id',
			'x-persi-timestamp',
			'x-persi-nonce',
			'x-persi-origin',
			'x-persi-signature',
		);
		$headers = array();
		foreach ( $names as $name ) {
			$headers[ $name ] = (string) $request->get_header( $name );
		}
		return $headers;
	}

	private function is_json( \WP_REST_Request $request ): bool {
		return 1 === preg_match(
			'/^application\/json(?:\s*;|$)/',
			strtolower( trim( (string) $request->get_header( 'content-type' ) ) )
		);
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
