<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\SessionService;
use Persi\HeadlessAccount\CustomerLists\CustomerListsService;
use Persi\HeadlessAccount\Security\AuthenticationException;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Logger;
use Persi\HeadlessAccount\Support\Response;

defined( 'ABSPATH' ) || exit;

final class CustomerListsController {
	private const NAMESPACE = 'persi-headless/v1';
	private const BASE_PATH = '/wp-json/persi-headless/v1';

	public function __construct(
		private readonly RequestAuthenticator $authenticator,
		private readonly SessionService $sessions,
		private readonly CustomerListsService $lists,
		private readonly Logger $logger
	) {}

	public function register_routes(): void {
		$list_route = '/customer-lists/(?P<list_type>[a-z][a-z0-9_-]{0,31})';
		register_rest_route( self::NAMESPACE, $list_route, array(
			array( 'methods' => \WP_REST_Server::READABLE, 'callback' => array( $this, 'index' ), 'permission_callback' => '__return_true' ),
			array( 'methods' => \WP_REST_Server::CREATABLE, 'callback' => array( $this, 'create' ), 'permission_callback' => '__return_true' ),
		) );
		register_rest_route( self::NAMESPACE, $list_route . '/(?P<product_id>[0-9]+)', array(
			'methods' => \WP_REST_Server::DELETABLE, 'callback' => array( $this, 'destroy' ), 'permission_callback' => '__return_true',
		) );
		register_rest_route( self::NAMESPACE, $list_route . '/sync', array(
			'methods' => 'PUT', 'callback' => array( $this, 'sync' ), 'permission_callback' => '__return_true',
		) );
	}

	public function index( \WP_REST_Request $request ): \WP_REST_Response {
		$context = $this->authorize( $request, 'GET' );
		return $context instanceof \WP_REST_Response ? $context : Response::json( $this->lists->all( (int) $context['user']->ID, $context['list_type'] ) );
	}

	public function create( \WP_REST_Request $request ): \WP_REST_Response {
		$context = $this->authorize( $request, 'POST' );
		if ( $context instanceof \WP_REST_Response ) return $context;
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) || array( 'productId' ) !== array_keys( $payload ) ) return Response::json( array( 'message' => 'Produto inválido.' ), 400 );
		$id = $this->product_id( $payload['productId'] );
		if ( null === $id ) return Response::json( array( 'message' => 'Produto inválido.' ), 400 );
		if ( ! $this->lists->add( (int) $context['user']->ID, $context['list_type'], $id ) ) return Response::json( array( 'message' => 'Não foi possível salvar o item.' ), 500 );
		return Response::json( $this->lists->all( (int) $context['user']->ID, $context['list_type'] ), 201 );
	}

	public function destroy( \WP_REST_Request $request ): \WP_REST_Response {
		$context = $this->authorize( $request, 'DELETE' );
		if ( $context instanceof \WP_REST_Response ) return $context;
		$id = $this->product_id( $request->get_param( 'product_id' ) );
		if ( null === $id ) return Response::json( array( 'message' => 'Produto inválido.' ), 400 );
		if ( ! $this->lists->remove( (int) $context['user']->ID, $context['list_type'], $id ) ) return Response::json( array( 'message' => 'Não foi possível remover o item.' ), 500 );
		return Response::json( $this->lists->all( (int) $context['user']->ID, $context['list_type'] ) );
	}

	public function sync( \WP_REST_Request $request ): \WP_REST_Response {
		$context = $this->authorize( $request, 'PUT' );
		if ( $context instanceof \WP_REST_Response ) return $context;
		$ids = $this->lists->normalize_product_ids( $request->get_json_params() );
		if ( null === $ids ) return Response::json( array( 'message' => 'Lista inválida.' ), 400 );
		if ( ! $this->lists->sync( (int) $context['user']->ID, $context['list_type'], $ids ) ) return Response::json( array( 'message' => 'Não foi possível sincronizar a lista.' ), 500 );
		return Response::json( $this->lists->all( (int) $context['user']->ID, $context['list_type'] ) );
	}

	private function authorize( \WP_REST_Request $request, string $method ) {
		$list_type = (string) $request->get_param( 'list_type' );
		if ( ! $this->lists->supports( $list_type ) ) return Response::json( array( 'message' => 'Tipo de lista não suportado.' ), 404 );
		$route = '/customer-lists/' . $list_type;
		if ( 'DELETE' === $method ) $route .= '/' . (string) $request->get_param( 'product_id' );
		if ( 'PUT' === $method ) $route .= '/sync';
		try {
			$this->authenticator->authenticate( $method, self::BASE_PATH . $route, $this->headers( $request ), $request->get_body() );
		} catch ( AuthenticationException $exception ) {
			$this->logger->write( 'warning', 'customer_lists_hmac_rejected', $exception->error_code() );
			return Response::json( array( 'message' => 'Requisição não autorizada.' ), 'service_unavailable' === $exception->error_code() ? 503 : 401 );
		}
		$session = $this->sessions->resolve( trim( (string) $request->get_header( 'x-persi-session' ) ) );
		return null === $session ? Response::json( array( 'message' => 'Sessão inválida.' ), 401 ) : array( 'user' => $session['user'], 'list_type' => $list_type );
	}

	private function product_id( $value ): ?int {
		$id = filter_var( $value, FILTER_VALIDATE_INT, array( 'options' => array( 'min_range' => 1 ) ) );
		return false === $id ? null : (int) $id;
	}

	private function headers( \WP_REST_Request $request ): array {
		$headers = array();
		foreach ( array( 'x-persi-key-id', 'x-persi-timestamp', 'x-persi-nonce', 'x-persi-origin', 'x-persi-signature' ) as $name ) $headers[ $name ] = (string) $request->get_header( $name );
		return $headers;
	}
}
