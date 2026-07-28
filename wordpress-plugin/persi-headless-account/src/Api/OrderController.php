<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\SessionService;
use Persi\HeadlessAccount\Orders\OrderPresenter;
use Persi\HeadlessAccount\Orders\OrderService;
use Persi\HeadlessAccount\Security\AuthenticationException;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Logger;
use Persi\HeadlessAccount\Support\Response;

defined( 'ABSPATH' ) || exit;

final class OrderController {
	private const NAMESPACE = 'persi-account/v1';
	private const BASE_PATH = '/wp-json/persi-account/v1';

	public function __construct(
		private readonly RequestAuthenticator $authenticator,
		private readonly SessionService $sessions,
		private readonly OrderService $orders,
		private readonly Logger $logger
	) {}

	public function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/orders', array(
			'methods' => \WP_REST_Server::READABLE,
			'callback' => array( $this, 'index' ),
			'permission_callback' => '__return_true',
		) );
		register_rest_route( self::NAMESPACE, '/orders/(?P<id>[0-9]+)', array(
			'methods' => \WP_REST_Server::READABLE,
			'callback' => array( $this, 'show' ),
			'permission_callback' => '__return_true',
		) );
	}

	public function index( \WP_REST_Request $request ): \WP_REST_Response {
		$user = $this->authorize( $request, '/orders' );
		if ( $user instanceof \WP_REST_Response ) return $user;
		$query = $request->get_query_params();
		if ( array_diff( array_keys( $query ), array( 'page', 'per_page', 'status' ) ) ) {
			return Response::json( array( 'message' => 'Parâmetros inválidos.' ), 400 );
		}
		$page = $this->integer( $query['page'] ?? null, 1, PHP_INT_MAX, 1 );
		$per_page = $this->integer( $query['per_page'] ?? null, 1, 20, 10 );
		$status = isset( $query['status'] ) && is_string( $query['status'] ) ? trim( $query['status'] ) : null;
		if ( null === $page || null === $per_page || ( null !== $status && ! in_array( $status, OrderPresenter::allowed_statuses(), true ) ) ) {
			return Response::json( array( 'message' => 'Parâmetros inválidos.' ), 400 );
		}
		return Response::json( $this->orders->list( (int) $user->ID, $page, $per_page, $status ) );
	}

	public function show( \WP_REST_Request $request ): \WP_REST_Response {
		$id = filter_var( $request->get_param( 'id' ), FILTER_VALIDATE_INT, array( 'options' => array( 'min_range' => 1 ) ) );
		if ( false === $id ) return $this->not_found();
		$user = $this->authorize( $request, '/orders/' . $id );
		if ( $user instanceof \WP_REST_Response ) return $user;
		$order = $this->orders->find( (int) $user->ID, (int) $id );
		return null === $order ? $this->not_found() : Response::json( array( 'order' => $order ) );
	}

	private function authorize( \WP_REST_Request $request, string $route ) {
		$raw_body = $request->get_body();
		try {
			$this->authenticator->authenticate( 'GET', self::BASE_PATH . $route, $this->headers( $request ), $raw_body );
		} catch ( AuthenticationException $exception ) {
			$this->logger->write( 'warning', 'orders_hmac_rejected', $exception->error_code() );
			return Response::json( array( 'message' => 'Requisição não autorizada.' ), 'service_unavailable' === $exception->error_code() ? 503 : 401 );
		}
		if ( '' !== $raw_body ) {
			return Response::json( array( 'message' => 'Requisição inválida.' ), 400 );
		}
		$token = trim( (string) $request->get_header( 'x-persi-session' ) );
		$session = $this->sessions->resolve( $token );
		if ( null === $session ) return Response::json( array( 'message' => 'Sessão inválida.' ), 401 );
		return $session['user'];
	}

	private function headers( \WP_REST_Request $request ): array {
		$headers = array();
		foreach ( array( 'x-persi-key-id', 'x-persi-timestamp', 'x-persi-nonce', 'x-persi-origin', 'x-persi-signature' ) as $name ) {
			$headers[ $name ] = (string) $request->get_header( $name );
		}
		return $headers;
	}

	private function integer( $value, int $min, int $max, int $default ): ?int {
		if ( null === $value ) return $default;
		if ( ! is_string( $value ) || ! preg_match( '/^[0-9]+$/', $value ) ) return null;
		$integer = (int) $value;
		return $integer >= $min && $integer <= $max ? $integer : null;
	}

	private function not_found(): \WP_REST_Response {
		return Response::json( array( 'message' => 'Pedido não encontrado.' ), 404 );
	}
}
