<?php

namespace Persi\HeadlessCheckout\Api;

use Persi\HeadlessCheckout\Checkout\TransferService;
use Persi\HeadlessCheckout\Security\AuthenticationException;
use Persi\HeadlessCheckout\Security\RequestAuthenticator;
use Persi\HeadlessCheckout\Support\Logger;
use Persi\HeadlessCheckout\Validation\TransferPayloadValidator;
use Persi\HeadlessCheckout\Validation\ValidationException;

defined( 'ABSPATH' ) || exit;

final class CheckoutTransferController {
	private const NAMESPACE = 'persi-headless/v1';
	private const ROUTE = '/checkout-transfer';

	private $authenticator;
	private $validator;
	private $service;
	private $logger;

	public function __construct(
		RequestAuthenticator $authenticator,
		TransferPayloadValidator $validator,
		TransferService $service,
		Logger $logger
	) {
		$this->authenticator = $authenticator;
		$this->validator     = $validator;
		$this->service       = $service;
		$this->logger        = $logger;
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'create_transfer' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public function create_transfer( \WP_REST_Request $request ): \WP_REST_Response {
		$raw_body = $request->get_body();

		if ( strlen( $raw_body ) > 32768 ) {
			return $this->error_response( 'invalid_request', 413 );
		}

		$content_type = strtolower( trim( (string) $request->get_header( 'content-type' ) ) );

		if ( 1 !== preg_match( '/^application\/json(?:\s*;|$)/', $content_type ) ) {
			return $this->error_response( 'invalid_request', 415 );
		}

		$secret = RequestAuthenticator::resolve_secret();

		if ( '' === $secret ) {
			return $this->error_response( 'service_unavailable', 503 );
		}

		try {
			$authentication = $this->authenticator->authenticate(
				$this->authentication_headers( $request ),
				$raw_body,
				time(),
				$secret,
				$this->allowed_origins()
			);
		} catch ( AuthenticationException $exception ) {
			$this->logger->warning( 'authentication_failed' );

			$status = 'service_unavailable' === $exception->get_error_code() ? 503 : 401;

			return $this->error_response(
				503 === $status ? 'service_unavailable' : 'authentication_failed',
				$status
			);
		}

		$browser_origin = $this->normalize_origin( (string) $request->get_header( 'origin' ) );

		if ( '' !== $browser_origin && $browser_origin !== $authentication->origin ) {
			$this->logger->warning( 'authentication_failed' );

			return $this->error_response( 'authentication_failed', 401 );
		}

		try {
			$payload = $this->validator->validate_json( $raw_body );
		} catch ( ValidationException $exception ) {
			$this->logger->warning( 'payload_rejected' );

			return $this->error_response( 'invalid_request', 400 );
		}

		$result = $this->service->create(
			$payload,
			$authentication->key_id,
			$authentication->nonce,
			$secret
		);

		if ( 'replay' === $result['status'] ) {
			return $this->error_response( 'authentication_failed', 409 );
		}

		if ( 'created' !== $result['status'] ) {
			return $this->error_response( 'service_unavailable', 503 );
		}

		return $this->response(
			array(
				'transferUrl' => $result['transfer_url'],
				'expiresAt'   => $result['expires_at'],
			),
			201
		);
	}

	private function authentication_headers( \WP_REST_Request $request ): array {
		return array(
			'x-persi-key-id'    => (string) $request->get_header( 'x-persi-key-id' ),
			'x-persi-timestamp' => (string) $request->get_header( 'x-persi-timestamp' ),
			'x-persi-nonce'     => (string) $request->get_header( 'x-persi-nonce' ),
			'x-persi-origin'    => (string) $request->get_header( 'x-persi-origin' ),
			'x-persi-signature' => (string) $request->get_header( 'x-persi-signature' ),
		);
	}

	private function allowed_origins(): array {
		$origins = array( $this->normalize_origin( home_url() ) );

		if ( defined( 'PERSI_HEADLESS_CHECKOUT_ALLOWED_ORIGINS' ) ) {
			$configured = constant( 'PERSI_HEADLESS_CHECKOUT_ALLOWED_ORIGINS' );

			if ( is_string( $configured ) ) {
				$origins = array_map( 'trim', explode( ',', $configured ) );
			} elseif ( is_array( $configured ) ) {
				$origins = $configured;
			}
		}

		$origins = array_map( array( $this, 'normalize_origin' ), $origins );

		return array_values( array_filter( array_unique( $origins ) ) );
	}

	private function normalize_origin( string $origin ): string {
		$parts = wp_parse_url( trim( $origin ) );

		if (
			false === $parts
			|| ! isset( $parts['scheme'], $parts['host'] )
			|| ! in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true )
			|| isset( $parts['user'] )
			|| isset( $parts['pass'] )
			|| isset( $parts['query'] )
			|| isset( $parts['fragment'] )
			|| ( isset( $parts['path'] ) && ! in_array( $parts['path'], array( '', '/' ), true ) )
		) {
			return '';
		}

		$normalized = strtolower( $parts['scheme'] ) . '://' . strtolower( $parts['host'] );

		if ( isset( $parts['port'] ) ) {
			$normalized .= ':' . (int) $parts['port'];
		}

		return $normalized;
	}

	private function error_response( string $code, int $status ): \WP_REST_Response {
		return $this->response(
			array(
				'code'    => $code,
				'message' => 'Não foi possível criar a transferência de checkout.',
			),
			$status
		);
	}

	private function response( array $data, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'Pragma', 'no-cache' );
		$response->header( 'Expires', '0' );
		$response->header( 'X-Content-Type-Options', 'nosniff' );

		return $response;
	}
}
