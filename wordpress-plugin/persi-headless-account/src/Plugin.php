<?php

namespace Persi\HeadlessAccount;

use Persi\HeadlessAccount\Api\AuthController;
use Persi\HeadlessAccount\Api\OAuthLoginController;
use Persi\HeadlessAccount\Api\OrderController;
use Persi\HeadlessAccount\Api\AccountAccessController;
use Persi\HeadlessAccount\Auth\CredentialsAuthenticator;
use Persi\HeadlessAccount\Auth\IdentityRepository;
use Persi\HeadlessAccount\Auth\OAuthIdentityService;
use Persi\HeadlessAccount\Auth\OAuthLoginService;
use Persi\HeadlessAccount\Auth\SessionRepository;
use Persi\HeadlessAccount\Auth\SessionService;
use Persi\HeadlessAccount\Auth\SessionToken;
use Persi\HeadlessAccount\Security\ClientFingerprint;
use Persi\HeadlessAccount\Security\NonceRepository;
use Persi\HeadlessAccount\Security\RateLimiter;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Orders\OrderPresenter;
use Persi\HeadlessAccount\Orders\OrderService;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\Logger;
use Persi\HeadlessAccount\Validation\LoginPayloadValidator;
use Persi\HeadlessAccount\Validation\AccountAccessPayloadValidator;
use Persi\HeadlessAccount\Validation\GoogleLoginPayloadValidator;
use Persi\HeadlessAccount\Validation\OAuthLoginPayloadValidator;

defined( 'ABSPATH' ) || exit;

final class Plugin {
	public static function boot(): void {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( self::class, 'woocommerce_notice' ) );
			return;
		}

		Activator::maybe_upgrade();

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
		$request_authenticator = new RequestAuthenticator(
			$configuration,
			new NonceRepository( $wpdb )
		);
		$controller = new AuthController(
			$request_authenticator,
			new CredentialsAuthenticator(),
			$sessions,
			new RateLimiter( $wpdb ),
			new ClientFingerprint( $configuration->secret() ),
			new LoginPayloadValidator(),
			$configuration,
			new Logger()
		);
		add_action( 'rest_api_init', array( $controller, 'register_routes' ) );
		$oauth_controller = new OAuthLoginController(
			$request_authenticator,
			new OAuthLoginPayloadValidator(),
			new GoogleLoginPayloadValidator(),
			new OAuthLoginService(
				new OAuthIdentityService(
					new IdentityRepository( $wpdb ),
					$configuration->secret()
				),
				$sessions,
				new RateLimiter( $wpdb ),
				new ClientFingerprint( $configuration->secret() ),
				$configuration,
				new Logger()
			),
			new Logger()
		);
		add_action( 'rest_api_init', array( $oauth_controller, 'register_routes' ) );
		$order_controller = new OrderController(
			$request_authenticator,
			$sessions,
			new OrderService( new OrderPresenter() ),
			new Logger()
		);
		add_action( 'rest_api_init', array( $order_controller, 'register_routes' ) );
		$access_controller = new AccountAccessController(
			$request_authenticator,
			new RateLimiter( $wpdb ),
			new ClientFingerprint( $configuration->secret() ),
			$configuration,
			new AccountAccessPayloadValidator()
		);
		add_action( 'rest_api_init', array( $access_controller, 'register_routes' ) );
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
