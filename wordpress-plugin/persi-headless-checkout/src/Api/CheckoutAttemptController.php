<?php

namespace Persi\HeadlessCheckout\Api;

use Persi\HeadlessCheckout\Checkout\CheckoutAttemptRepository;
use Persi\HeadlessCheckout\Security\AuthenticationException;
use Persi\HeadlessCheckout\Security\RequestAuthenticator;

defined( 'ABSPATH' ) || exit;

final class CheckoutAttemptController {
	private const ROUTE_PATH = '/wp-json/persi-headless/v1/checkout-attempt';
	private $authenticator;
	private $repository;

	public function __construct( RequestAuthenticator $authenticator, CheckoutAttemptRepository $repository ) {
		$this->authenticator = $authenticator;
		$this->repository    = $repository;
	}

	public function register_routes(): void {
		register_rest_route( 'persi-headless/v1', '/checkout-attempt', array(
			'methods' => \WP_REST_Server::CREATABLE,
			'callback' => array( $this, 'handle' ),
			'permission_callback' => '__return_true',
		) );
	}

	public function handle( \WP_REST_Request $request ): \WP_REST_Response {
		$raw = $request->get_body();
		if ( strlen( $raw ) > 4096 ) {
			return $this->response( array( 'code' => 'invalid_request' ), 413 );
		}
		try {
			$this->authenticator->authenticate(
				array(
					'x-persi-key-id' => (string) $request->get_header( 'x-persi-key-id' ),
					'x-persi-timestamp' => (string) $request->get_header( 'x-persi-timestamp' ),
					'x-persi-nonce' => (string) $request->get_header( 'x-persi-nonce' ),
					'x-persi-origin' => (string) $request->get_header( 'x-persi-origin' ),
					'x-persi-signature' => (string) $request->get_header( 'x-persi-signature' ),
				),
				$raw,
				time(),
				RequestAuthenticator::resolve_secret(),
				$this->allowed_origins(),
				self::ROUTE_PATH
			);
		} catch ( AuthenticationException $exception ) {
			return $this->response( array( 'code' => 'authentication_failed' ), 401 );
		}

		$payload = json_decode( $raw, true );
		if ( ! is_array( $payload ) || ! isset( $payload['action'] ) ) {
			return $this->response( array( 'code' => 'invalid_request' ), 400 );
		}

		$id = isset( $payload['checkout_attempt_id'] ) ? strtolower( (string) $payload['checkout_attempt_id'] ) : '';
		if ( ! in_array( $payload['action'], array( 'reconcile', 'health' ), true ) && ! preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $id ) ) {
			return $this->response( array( 'code' => 'invalid_request' ), 400 );
		}
		if ( 'reserve' === $payload['action'] ) {
			$method = isset( $payload['payment_method'] ) ? (string) $payload['payment_method'] : '';
			if ( ! in_array( $method, array( 'inter_pix', 'inter_boleto', 'mercadopago_card', 'pagbank_apple_pay', 'pagbank_google_pay' ), true ) ) {
				return $this->response( array( 'code' => 'invalid_request' ), 400 );
			}
			$provider = 0 === strpos( $method, 'inter_' ) ? 'inter' : ( 'mercadopago_card' === $method ? 'mercadopago' : 'pagbank' );
			$result = $this->repository->reserve( $id, $provider, $method );
			return $this->response( $result, $result['acquired'] ? 201 : 200 );
		}

		if ( 'get' === $payload['action'] ) {
			$attempt = $this->repository->find( $id );
			return $attempt ? $this->response( array( 'attempt' => $attempt ), 200 ) : $this->response( array( 'code' => 'not_found' ), 404 );
		}

		if ( 'transition' === $payload['action'] && isset( $payload['lease_token'], $payload['from'], $payload['to'] ) ) {
			$ok = $this->repository->transition( $id, (string) $payload['lease_token'], (string) $payload['from'], (string) $payload['to'], $payload );
			return $this->response( array( 'updated' => $ok, 'attempt' => $this->repository->find( $id ) ), $ok ? 200 : 409 );
		}

		if ( 'reconcile' === $payload['action'] && isset( $payload['provider_reference'], $payload['to'] ) ) {
			$reference = substr( trim( (string) $payload['provider_reference'] ), 0, 128 );
			$updated = '' !== $reference && $this->repository->reconcile_payment( $reference, (string) $payload['to'] );
			return $this->response( array( 'updated' => $updated ), $updated ? 200 : 409 );
		}

		if ( 'health' === $payload['action'] ) {
			$health = $this->repository->health();
			return $this->response( $health, $health['healthy'] ? 200 : 503 );
		}

		return $this->response( array( 'code' => 'invalid_request' ), 400 );
	}

	private function allowed_origins(): array {
		$configured = defined( 'PERSI_HEADLESS_CHECKOUT_ALLOWED_ORIGINS' ) ? constant( 'PERSI_HEADLESS_CHECKOUT_ALLOWED_ORIGINS' ) : home_url();
		$origins = is_array( $configured ) ? $configured : explode( ',', (string) $configured );
		return array_values( array_filter( array_map( static function ( $origin ) {
			$parts = wp_parse_url( trim( (string) $origin ) );
			return is_array( $parts ) && isset( $parts['scheme'], $parts['host'] ) ? strtolower( $parts['scheme'] ) . '://' . strtolower( $parts['host'] ) . ( isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '' ) : '';
		}, $origins ) ) );
	}

	private function response( array $data, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0' );
		$response->header( 'X-Content-Type-Options', 'nosniff' );
		return $response;
	}
}
