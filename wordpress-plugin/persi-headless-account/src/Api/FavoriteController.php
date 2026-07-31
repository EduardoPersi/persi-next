<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\SessionService;
use Persi\HeadlessAccount\Favorites\FavoriteRepository;
use Persi\HeadlessAccount\Security\AuthenticationException;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Logger;
use Persi\HeadlessAccount\Support\Response;

defined( 'ABSPATH' ) || exit;

final class FavoriteController {
	private const NAMESPACE = 'persi-headless/v1';
	private const BASE_PATH = '/wp-json/persi-headless/v1';
	private const MAX_FAVORITES = 500;

	public function __construct(
		private readonly RequestAuthenticator $authenticator,
		private readonly SessionService $sessions,
		private readonly FavoriteRepository $favorites,
		private readonly Logger $logger
	) {}

	public function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/favorites', array(
			array( 'methods' => \WP_REST_Server::READABLE, 'callback' => array( $this, 'index' ), 'permission_callback' => '__return_true' ),
			array( 'methods' => \WP_REST_Server::CREATABLE, 'callback' => array( $this, 'create' ), 'permission_callback' => '__return_true' ),
		) );
		register_rest_route( self::NAMESPACE, '/favorites/(?P<product_id>[0-9]+)', array(
			'methods' => \WP_REST_Server::DELETABLE, 'callback' => array( $this, 'destroy' ), 'permission_callback' => '__return_true',
		) );
		register_rest_route( self::NAMESPACE, '/favorites/sync', array(
			'methods' => 'PUT', 'callback' => array( $this, 'sync' ), 'permission_callback' => '__return_true',
		) );
	}

	public function index( \WP_REST_Request $request ): \WP_REST_Response {
		$user = $this->authorize( $request, 'GET', '/favorites' );
		return $user instanceof \WP_REST_Response ? $user : Response::json( $this->favorites->all( (int) $user->ID ) );
	}

	public function create( \WP_REST_Request $request ): \WP_REST_Response {
		$user = $this->authorize( $request, 'POST', '/favorites' );
		if ( $user instanceof \WP_REST_Response ) return $user;
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) || array( 'productId' ) !== array_keys( $payload ) ) return Response::json( array( 'message' => 'Produto invÃ¡lido.' ), 400 );
		$id = $this->product_id( $payload['productId'] );
		if ( null === $id ) return Response::json( array( 'message' => 'Produto invÃ¡lido.' ), 400 );
		if ( ! $this->favorites->add( (int) $user->ID, $id, current_time( 'mysql', true ) ) ) return Response::json( array( 'message' => 'NÃ£o foi possÃ­vel salvar o favorito.' ), 500 );
		return Response::json( array( 'productId' => $id, 'createdAt' => gmdate( 'c' ) ), 201 );
	}

	public function destroy( \WP_REST_Request $request ): \WP_REST_Response {
		$id = $this->product_id( $request->get_param( 'product_id' ) );
		if ( null === $id ) return Response::json( array( 'message' => 'Produto invÃ¡lido.' ), 400 );
		$user = $this->authorize( $request, 'DELETE', '/favorites/' . $id );
		if ( $user instanceof \WP_REST_Response ) return $user;
		if ( ! $this->favorites->remove( (int) $user->ID, $id ) ) return Response::json( array( 'message' => 'NÃ£o foi possÃ­vel remover o favorito.' ), 500 );
		return Response::json( array( 'success' => true ) );
	}

	public function sync( \WP_REST_Request $request ): \WP_REST_Response {
		$user = $this->authorize( $request, 'PUT', '/favorites/sync' );
		if ( $user instanceof \WP_REST_Response ) return $user;
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) || count( $payload ) > self::MAX_FAVORITES ) return Response::json( array( 'message' => 'Lista de favoritos invÃ¡lida.' ), 400 );
		$ids = array();
		foreach ( $payload as $value ) {
			$id = $this->product_id( $value );
			if ( null === $id ) return Response::json( array( 'message' => 'Lista de favoritos invÃ¡lida.' ), 400 );
			$ids[ $id ] = $id;
		}
		if ( ! $this->favorites->sync( (int) $user->ID, array_values( $ids ), current_time( 'mysql', true ) ) ) return Response::json( array( 'message' => 'NÃ£o foi possÃ­vel sincronizar os favoritos.' ), 500 );
		return Response::json( $this->favorites->all( (int) $user->ID ) );
	}

	private function authorize( \WP_REST_Request $request, string $method, string $route ) {
		try {
			$this->authenticator->authenticate( $method, self::BASE_PATH . $route, $this->headers( $request ), $request->get_body() );
		} catch ( AuthenticationException $exception ) {
			$this->logger->write( 'warning', 'favorites_hmac_rejected', $exception->error_code() );
			return Response::json( array( 'message' => 'RequisiÃ§Ã£o nÃ£o autorizada.' ), 'service_unavailable' === $exception->error_code() ? 503 : 401 );
		}
		$session = $this->sessions->resolve( trim( (string) $request->get_header( 'x-persi-session' ) ) );
		return null === $session ? Response::json( array( 'message' => 'SessÃ£o invÃ¡lida.' ), 401 ) : $session['user'];
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
