<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\OAuthLoginService;
use Persi\HeadlessAccount\Security\AuthenticationException;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\Logger;
use Persi\HeadlessAccount\Support\Response;
use Persi\HeadlessAccount\Validation\GoogleLoginPayloadValidator;
use Persi\HeadlessAccount\Validation\OAuthLoginPayloadValidator;
use Persi\HeadlessAccount\Validation\ValidationException;

defined( 'ABSPATH' ) || exit;

final class OAuthLoginController {
	private const NAMESPACE = 'persi-headless-account/v1';
	private const PATH = '/wp-json/persi-headless-account/v1/oauth-login';
	private const LEGACY_NAMESPACE = 'persi-account/v1';
	private const LEGACY_PATH = '/wp-json/persi-account/v1/google-login';

	public function __construct(
		private readonly RequestAuthenticator $request_authenticator,
		private readonly OAuthLoginPayloadValidator $validator,
		private readonly GoogleLoginPayloadValidator $legacy_validator,
		private readonly OAuthLoginService $service,
		private readonly Logger $logger
	) {}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/oauth-login',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'login' ),
				'permission_callback' => '__return_true',
			)
		);
		register_rest_route(
			self::LEGACY_NAMESPACE,
			'/google-login',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'legacy_google_login' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public function login( \WP_REST_Request $request ): \WP_REST_Response {
		return $this->process( $request, self::PATH, false );
	}

	public function legacy_google_login( \WP_REST_Request $request ): \WP_REST_Response {
		return $this->process( $request, self::LEGACY_PATH, true );
	}

	private function process(
		\WP_REST_Request $request,
		string $path,
		bool $legacy
	): \WP_REST_Response {
		$raw_body = $request->get_body();
		try {
			$auth = $this->request_authenticator->authenticate(
				'POST',
				$path,
				$this->headers( $request ),
				$raw_body
			);
		} catch ( AuthenticationException $exception ) {
			$this->logger->write(
				'warning',
				'oauth_hmac_rejected',
				'OAUTH_HMAC_REJECTED'
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
			$identity = $legacy
				? $this->normalize_legacy(
					$this->legacy_validator->validate( $raw_body )
				)
				: $this->validator->validate( $raw_body );
		} catch ( ValidationException $exception ) {
			$this->logger->write(
				'warning',
				'oauth_payload_rejected',
				'OAUTH_PAYLOAD_REJECTED',
				$auth->key_id
			);
			return Response::json( array( 'message' => 'Dados inválidos.' ), 400 );
		}

		$result = $this->service->login( $identity, $auth->key_id, $_SERVER );
		return Response::json(
			$result['body'],
			$result['status'],
			$result['retry_after'] ?? null
		);
	}

	private function normalize_legacy( array $identity ): array {
		return array(
			'provider'       => 'google',
			'provider_id'    => $identity['subject'],
			'email'          => $identity['email'],
			'verified_email' => true,
			'name'           => $identity['display_name'],
			'avatar'         => $identity['picture'],
			'first_name'     => $identity['first_name'],
			'last_name'      => $identity['last_name'],
		);
	}

	private function headers( \WP_REST_Request $request ): array {
		$headers = array();
		foreach ( array( 'x-persi-key-id', 'x-persi-timestamp', 'x-persi-nonce', 'x-persi-origin', 'x-persi-signature' ) as $name ) {
			$headers[ $name ] = (string) $request->get_header( $name );
		}
		return $headers;
	}
}
