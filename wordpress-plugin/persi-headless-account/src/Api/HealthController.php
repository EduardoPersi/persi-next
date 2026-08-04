<?php

namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Support\Configuration;

defined( 'ABSPATH' ) || exit;

final class HealthController {
	private const NAMESPACE = 'persi-auth/v1';

	public function __construct( private readonly Configuration $configuration ) {}

	public function register_routes(): void {
		register_rest_route( self::NAMESPACE, '/health', array(
			'methods'             => \WP_REST_Server::READABLE,
			'callback'            => array( $this, 'health' ),
			'permission_callback' => '__return_true',
		) );
	}

	public function health(): \WP_REST_Response {
		$routes = rest_get_server()->get_routes();
		$jwt_available = defined( 'JWT_AUTH_SECRET_KEY' ) && isset( $routes['/jwt-auth/v1/token'], $routes['/jwt-auth/v1/token/validate'] );
		$response = new \WP_REST_Response( array(
			'version'     => defined( 'PERSI_HEADLESS_ACCOUNT_VERSION' ) ? PERSI_HEADLESS_ACCOUNT_VERSION : 'unknown',
			'jwt'         => $jwt_available ? 'ok' : 'unavailable',
			'woocommerce' => class_exists( 'WooCommerce' ) ? 'ok' : 'unavailable',
			'google'      => '' !== $this->configuration->google_client_id() ? 'configured' : 'not_configured',
			'facebook'    => '' !== $this->configuration->facebook_app_id() && '' !== $this->configuration->facebook_app_secret() ? 'configured' : 'not_configured',
			'php'         => PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION,
			'wordpress'   => get_bloginfo( 'version' ),
			'jwt_plugin'  => $this->jwt_plugin_version(),
		), 200 );
		$response->header( 'Cache-Control', 'no-store, max-age=0' );
		return $response;
	}

	private function jwt_plugin_version(): string {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		foreach ( get_plugins() as $file => $data ) {
			$name = is_string( $data['Name'] ?? null ) ? $data['Name'] : '';
			$text_domain = is_string( $data['TextDomain'] ?? null ) ? $data['TextDomain'] : '';
			if ( str_contains( $file, 'jwt-auth' ) || 'jwt-auth' === $text_domain || 1 === preg_match( '/JWT Authentication.*WP.*API/i', $name ) ) {
				return is_string( $data['Version'] ?? null ) && '' !== $data['Version'] ? $data['Version'] : 'unknown';
			}
		}

		return 'unavailable';
	}
}
