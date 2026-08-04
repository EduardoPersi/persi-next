<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\BearerAuthorization;
use Persi\HeadlessAccount\CustomerLists\CustomerListsService;
use Persi\HeadlessAccount\Support\Response;

defined( 'ABSPATH' ) || exit;

final class CustomerListsController {
	private const NAMESPACE = 'persi-headless/v1';
	public function __construct( private readonly BearerAuthorization $authorization, private readonly CustomerListsService $lists ) {}

	public function register_routes(): void {
		$route = '/customer-lists/(?P<list_type>[a-z][a-z0-9_-]{0,31})';
		register_rest_route( self::NAMESPACE, $route, array(
			array( 'methods' => \WP_REST_Server::READABLE, 'callback' => array( $this, 'index' ), 'permission_callback' => '__return_true' ),
			array( 'methods' => \WP_REST_Server::CREATABLE, 'callback' => array( $this, 'create' ), 'permission_callback' => '__return_true' ),
		) );
		register_rest_route( self::NAMESPACE, $route . '/(?P<product_id>[0-9]+)', array( 'methods' => \WP_REST_Server::DELETABLE, 'callback' => array( $this, 'destroy' ), 'permission_callback' => '__return_true' ) );
		register_rest_route( self::NAMESPACE, $route . '/sync', array( 'methods' => 'PUT', 'callback' => array( $this, 'sync' ), 'permission_callback' => '__return_true' ) );
	}

	public function index( \WP_REST_Request $request ): \WP_REST_Response {
		$context = $this->context( $request );
		return $context instanceof \WP_REST_Response ? $context : Response::json( $this->lists->all( $context['user']->ID, $context['list_type'] ) );
	}
	public function create( \WP_REST_Request $request ): \WP_REST_Response {
		$context = $this->context( $request ); if ( $context instanceof \WP_REST_Response ) return $context;
		$payload = $request->get_json_params();
		$id = is_array( $payload ) && array( 'productId' ) === array_keys( $payload ) ? $this->product_id( $payload['productId'] ) : null;
		if ( null === $id ) return Response::json( array( 'message' => 'Produto inválido.' ), 400 );
		if ( ! $this->lists->add( $context['user']->ID, $context['list_type'], $id ) ) return Response::json( array( 'message' => 'Não foi possível salvar o item.' ), 500 );
		return Response::json( $this->lists->all( $context['user']->ID, $context['list_type'] ), 201 );
	}
	public function destroy( \WP_REST_Request $request ): \WP_REST_Response {
		$context = $this->context( $request ); if ( $context instanceof \WP_REST_Response ) return $context;
		$id = $this->product_id( $request->get_param( 'product_id' ) ); if ( null === $id ) return Response::json( array( 'message' => 'Produto inválido.' ), 400 );
		if ( ! $this->lists->remove( $context['user']->ID, $context['list_type'], $id ) ) return Response::json( array( 'message' => 'Não foi possível remover o item.' ), 500 );
		return Response::json( $this->lists->all( $context['user']->ID, $context['list_type'] ) );
	}
	public function sync( \WP_REST_Request $request ): \WP_REST_Response {
		$context = $this->context( $request ); if ( $context instanceof \WP_REST_Response ) return $context;
		$ids = $this->lists->normalize_product_ids( $request->get_json_params() ); if ( null === $ids ) return Response::json( array( 'message' => 'Lista inválida.' ), 400 );
		if ( ! $this->lists->sync( $context['user']->ID, $context['list_type'], $ids ) ) return Response::json( array( 'message' => 'Não foi possível sincronizar a lista.' ), 500 );
		return Response::json( $this->lists->all( $context['user']->ID, $context['list_type'] ) );
	}

	private function context( \WP_REST_Request $request ) {
		$list_type = (string) $request->get_param( 'list_type' );
		if ( ! $this->lists->supports( $list_type ) ) return Response::json( array( 'message' => 'Tipo de lista não suportado.' ), 404 );
		$user = $this->authorization->user( $request );
		return is_wp_error( $user ) ? Response::json( array( 'message' => $user->get_error_message() ), 401 ) : array( 'user' => $user, 'list_type' => $list_type );
	}
	private function product_id( $value ): ?int { $id = filter_var( $value, FILTER_VALIDATE_INT, array( 'options' => array( 'min_range' => 1 ) ) ); return false === $id ? null : (int) $id; }
}
