<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\BearerAuthorization;
use Persi\HeadlessAccount\Orders\OrderPresenter;
use Persi\HeadlessAccount\Orders\OrderService;
use Persi\HeadlessAccount\Support\Response;

defined( 'ABSPATH' ) || exit;

final class OrderController {
	private const NAMESPACE = 'persi-account/v1';

	public function __construct( private readonly BearerAuthorization $authorization, private readonly OrderService $orders ) {}

	public function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/orders', array( 'methods' => \WP_REST_Server::READABLE, 'callback' => array( $this, 'index' ), 'permission_callback' => '__return_true' ) );
		register_rest_route( self::NAMESPACE, '/orders/(?P<id>[0-9]+)', array( 'methods' => \WP_REST_Server::READABLE, 'callback' => array( $this, 'show' ), 'permission_callback' => '__return_true' ) );
	}

	public function index( \WP_REST_Request $request ): \WP_REST_Response {
		$user = $this->authorization->user( $request );
		if ( is_wp_error( $user ) ) return Response::json( array( 'message' => $user->get_error_message() ), 401 );
		$query = $request->get_query_params();
		if ( array_diff( array_keys( $query ), array( 'page', 'per_page', 'status' ) ) ) return Response::json( array( 'message' => 'Parâmetros inválidos.' ), 400 );
		$page = $this->integer( $query['page'] ?? null, 1, PHP_INT_MAX, 1 );
		$per_page = $this->integer( $query['per_page'] ?? null, 1, 20, 10 );
		$status = isset( $query['status'] ) && is_string( $query['status'] ) ? trim( $query['status'] ) : null;
		if ( null === $page || null === $per_page || ( null !== $status && ! in_array( $status, OrderPresenter::allowed_statuses(), true ) ) ) return Response::json( array( 'message' => 'Parâmetros inválidos.' ), 400 );
		return Response::json( $this->orders->list( (int) $user->ID, $page, $per_page, $status ) );
	}

	public function show( \WP_REST_Request $request ): \WP_REST_Response {
		$id = filter_var( $request->get_param( 'id' ), FILTER_VALIDATE_INT, array( 'options' => array( 'min_range' => 1 ) ) );
		if ( false === $id ) return $this->not_found();
		$user = $this->authorization->user( $request );
		if ( is_wp_error( $user ) ) return Response::json( array( 'message' => $user->get_error_message() ), 401 );
		$order = $this->orders->find( (int) $user->ID, (int) $id );
		return null === $order ? $this->not_found() : Response::json( array( 'order' => $order ) );
	}

	private function integer( $value, int $min, int $max, int $default ): ?int {
		if ( null === $value ) return $default;
		if ( ! is_string( $value ) || ! preg_match( '/^[0-9]+$/', $value ) ) return null;
		$integer = (int) $value;
		return $integer >= $min && $integer <= $max ? $integer : null;
	}

	private function not_found(): \WP_REST_Response { return Response::json( array( 'message' => 'Pedido não encontrado.' ), 404 ); }
}
