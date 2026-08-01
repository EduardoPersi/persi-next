<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Diagnostics\OAuthAuditService;
use Persi\HeadlessAccount\Security\AuthenticationException;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Response;

defined( 'ABSPATH' ) || exit;

final class OAuthAuditController {
	private const NAMESPACE = 'persi-headless-account/v1';
	private const ROUTE = '/debug/oauth-audit';
	private const PATH = '/wp-json/persi-headless-account/v1/debug/oauth-audit';

	public function __construct(
		private readonly RequestAuthenticator $authenticator,
		private readonly OAuthAuditService $audit
	) {}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			array(
				'methods'             => \WP_REST_Server::READABLE,
				'callback'            => array( $this, 'report' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	public function report( \WP_REST_Request $request ): \WP_REST_Response {
		try {
			$this->authenticator->authenticate(
				'GET',
				self::PATH,
				$this->headers( $request ),
				$request->get_body()
			);
		} catch ( AuthenticationException $exception ) {
			return $this->forbidden();
		}

		if ( '' !== $request->get_body() || ! current_user_can( 'manage_options' ) ) {
			return $this->forbidden();
		}

		return Response::json( $this->audit->report() );
	}

	private function forbidden(): \WP_REST_Response {
		return Response::json( array( 'message' => 'Forbidden' ), 403 );
	}

	private function headers( \WP_REST_Request $request ): array {
		$headers = array();
		foreach ( array( 'x-persi-key-id', 'x-persi-timestamp', 'x-persi-nonce', 'x-persi-origin', 'x-persi-signature' ) as $name ) {
			$headers[ $name ] = (string) $request->get_header( $name );
		}
		return $headers;
	}
}
