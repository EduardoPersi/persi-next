<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Auth\GoogleTokenVerifier;
use Persi\HeadlessAccount\Auth\MetaTokenVerifier;
use Persi\HeadlessAccount\Auth\OAuthIdentityService;
use Persi\HeadlessAccount\Auth\OfficialJwtAdapter;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\Response;

defined( 'ABSPATH' ) || exit;

final class SocialJwtController {
	private const NAMESPACE = 'persi-auth/v1';

	public function __construct(
		private readonly Configuration $configuration,
		private readonly GoogleTokenVerifier $google,
		private readonly MetaTokenVerifier $meta,
		private readonly OAuthIdentityService $identities,
		private readonly OfficialJwtAdapter $jwt
	) {}

	public function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/oauth/token', array(
			'methods'             => \WP_REST_Server::CREATABLE,
			'callback'            => array( $this, 'token' ),
			'permission_callback' => '__return_true',
		) );
	}

	public function token( \WP_REST_Request $request ): \WP_REST_Response {
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) || array_diff( array_keys( $payload ), array( 'provider', 'token' ) ) || ! is_string( $payload['provider'] ?? null ) || ! is_string( $payload['token'] ?? null ) ) {
			return Response::json( array( 'message' => 'Dados inválidos.' ), 400 );
		}

		$provider = $payload['provider'];
		$identity = 'google' === $provider ? $this->google_identity( $payload['token'] ) : ( 'facebook' === $provider ? $this->facebook_identity( $payload['token'] ) : null );
		if ( ! is_array( $identity ) ) return Response::json( array( 'message' => 'Identidade social inválida.' ), 401 );

		$user = $this->identities->resolve( $identity );
		if ( ! $user instanceof \WP_User ) return Response::json( array( 'message' => 'Conflito de identidade.' ), 409 );

		try {
			return Response::json( $this->jwt->issue_for_user( $user ) );
		} catch ( \RuntimeException $error ) {
			return Response::json( array( 'message' => 'Serviço JWT oficial indisponível.' ), 503 );
		}
	}

	private function google_identity( string $token ): ?array {
		$claims = $this->google->verify( $token, $this->configuration->google_client_id() );
		if ( ! is_array( $claims ) ) return null;
		return array( 'provider' => 'google', 'provider_id' => $claims['sub'], 'email' => strtolower( $claims['email'] ), 'name' => (string) ( $claims['name'] ?? $claims['email'] ), 'avatar' => (string) ( $claims['picture'] ?? '' ), 'first_name' => (string) ( $claims['given_name'] ?? '' ), 'last_name' => (string) ( $claims['family_name'] ?? '' ) );
	}

	private function facebook_identity( string $token ): ?array {
		$profile = $this->meta->verify( $token, $this->configuration->facebook_app_id(), $this->configuration->facebook_app_secret(), $this->configuration->facebook_graph_version() );
		if ( ! is_array( $profile ) ) return null;
		return array( 'provider' => 'facebook', 'provider_id' => $profile['id'], 'email' => strtolower( $profile['email'] ), 'name' => (string) ( $profile['name'] ?? $profile['email'] ), 'avatar' => (string) ( $profile['picture']['data']['url'] ?? '' ), 'first_name' => (string) ( $profile['first_name'] ?? '' ), 'last_name' => (string) ( $profile['last_name'] ?? '' ) );
	}
}
