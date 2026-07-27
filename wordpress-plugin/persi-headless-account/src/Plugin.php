<?php

namespace Persi\HeadlessAccount;

use Persi\HeadlessAccount\Api\AuthController;
use Persi\HeadlessAccount\Auth\CredentialsAuthenticator;
use Persi\HeadlessAccount\Auth\SessionRepository;
use Persi\HeadlessAccount\Auth\SessionService;
use Persi\HeadlessAccount\Auth\SessionToken;
use Persi\HeadlessAccount\Security\ClientFingerprint;
use Persi\HeadlessAccount\Security\NonceRepository;
use Persi\HeadlessAccount\Security\RateLimiter;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\Logger;
use Persi\HeadlessAccount\Validation\LoginPayloadValidator;

defined( 'ABSPATH' ) || exit;

final class Plugin {
	public static function boot(): void {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( self::class, 'woocommerce_notice' ) );
			return;
		}

		$configuration = new Configuration();
		if (
			'' === $configuration->secret() ||
			empty( $configuration->allowed_origins() )
		) {
			add_action( 'admin_notices', array( self::class, 'configuration_notice' ) );
		}

		global $wpdb;
		$sessions = new SessionService(
			new SessionRepository( $wpdb ),
			new SessionToken()
		);
		$controller = new AuthController(
			new RequestAuthenticator(
				$configuration,
				new NonceRepository( $wpdb )
			),
			new CredentialsAuthenticator(),
			$sessions,
			new RateLimiter( $wpdb ),
			new ClientFingerprint( $configuration->secret() ),
			new LoginPayloadValidator(),
			$configuration,
			new Logger()
		);
		add_action( 'rest_api_init', array( $controller, 'register_routes' ) );
	}

	public static function woocommerce_notice(): void {
		if ( ! current_user_can( 'activate_plugins' ) ) {
			return;
		}
		echo '<div class="notice notice-error"><p>';
		echo esc_html__( 'Persi Headless Account requer que o WooCommerce esteja ativo.', 'persi-headless-account' );
		echo '</p></div>';
	}

	public static function configuration_notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}
		echo '<div class="notice notice-warning"><p>';
		echo esc_html__( 'Persi Headless Account requer segredo HMAC e origens permitidas.', 'persi-headless-account' );
		echo '</p></div>';
	}
}
