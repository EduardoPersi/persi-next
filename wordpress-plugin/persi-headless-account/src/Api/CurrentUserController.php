<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\BearerAuthorization;
use Persi\HeadlessAccount\Support\Response;

defined( 'ABSPATH' ) || exit;

final class CurrentUserController {
	private const NAMESPACE = 'persi-auth/v1';
	public function __construct( private readonly BearerAuthorization $authorization ) {}
	public function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/me', array( 'methods' => \WP_REST_Server::READABLE, 'callback' => array( $this, 'me' ), 'permission_callback' => '__return_true' ) );
	}
	public function me( \WP_REST_Request $request ): \WP_REST_Response {
		$user = $this->authorization->user( $request );
		if ( is_wp_error( $user ) ) return Response::json( array( 'message' => $user->get_error_message() ), 401 );
		return Response::json( array(
			'id' => (int) $user->ID,
			'email' => (string) $user->user_email,
			'slug' => (string) $user->user_nicename,
			'name' => (string) $user->display_name,
			'first_name' => (string) get_user_meta( $user->ID, 'first_name', true ),
			'last_name' => (string) get_user_meta( $user->ID, 'last_name', true ),
			'roles' => array_values( $user->roles ),
			'avatar_urls' => array( '96' => get_avatar_url( $user->ID, array( 'size' => 96 ) ) ),
			'capabilities' => array_filter( $user->allcaps, static fn( $enabled ): bool => true === $enabled ),
		) );
	}
}
