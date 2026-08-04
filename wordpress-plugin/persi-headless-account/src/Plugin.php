<?php

namespace Persi\HeadlessAccount;

use Persi\HeadlessAccount\Api\AccountAccessController;
use Persi\HeadlessAccount\Api\CustomerListsController;
use Persi\HeadlessAccount\Api\CustomerWorkspaceController;
use Persi\HeadlessAccount\Api\CurrentUserController;
use Persi\HeadlessAccount\Api\HealthController;
use Persi\HeadlessAccount\Api\OrderController;
use Persi\HeadlessAccount\Api\SocialJwtController;
use Persi\HeadlessAccount\Auth\BearerAuthorization;
use Persi\HeadlessAccount\Auth\GoogleTokenVerifier;
use Persi\HeadlessAccount\Auth\IdentityRepository;
use Persi\HeadlessAccount\Auth\MetaTokenVerifier;
use Persi\HeadlessAccount\Auth\OAuthIdentityService;
use Persi\HeadlessAccount\Auth\OfficialJwtAdapter;
use Persi\HeadlessAccount\Auth\OfficialJwtResponseMetadata;
use Persi\HeadlessAccount\CustomerLists\CustomerListRepository;
use Persi\HeadlessAccount\CustomerLists\CustomerListsService;
use Persi\HeadlessAccount\CustomerWorkspace\CustomerWorkspaceService;
use Persi\HeadlessAccount\Orders\OrderPresenter;
use Persi\HeadlessAccount\Orders\OrderService;
use Persi\HeadlessAccount\Security\ClientFingerprint;
use Persi\HeadlessAccount\Security\RateLimiter;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Validation\AccountAccessPayloadValidator;

defined( 'ABSPATH' ) || exit;

final class Plugin {
	public static function boot(): void {
		$config = new Configuration();
		$health = new HealthController( $config );
		add_action( 'rest_api_init', array( $health, 'register_routes' ) );

		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( self::class, 'woocommerce_notice' ) );
			return;
		}
		if ( ! defined( 'JWT_AUTH_SECRET_KEY' ) ) {
			add_action( 'admin_notices', array( self::class, 'jwt_notice' ) );
			return;
		}

		Activator::maybe_upgrade();
		global $wpdb;
		$bearer = new BearerAuthorization();
		( new OfficialJwtResponseMetadata() )->register();
		$identity = new OAuthIdentityService( new IdentityRepository( $wpdb ) );

		$controllers = array(
			new SocialJwtController( $config, new GoogleTokenVerifier(), new MetaTokenVerifier(), $identity, new OfficialJwtAdapter() ),
			new CurrentUserController( $bearer ),
			new OrderController( $bearer, new OrderService( new OrderPresenter() ) ),
			new CustomerListsController( $bearer, new CustomerListsService( new CustomerListRepository( $wpdb ) ) ),
			new CustomerWorkspaceController( $bearer, new CustomerWorkspaceService( $wpdb ) ),
			new AccountAccessController( new RateLimiter( $wpdb ), new ClientFingerprint( wp_salt( 'auth' ) ), $config, new AccountAccessPayloadValidator() ),
		);
		foreach ( $controllers as $controller ) add_action( 'rest_api_init', array( $controller, 'register_routes' ) );
	}

	public static function woocommerce_notice(): void {
		echo '<div class="notice notice-error"><p>' . esc_html__( 'Persi Headless Account requer WooCommerce.', 'persi-headless-account' ) . '</p></div>';
	}

	public static function jwt_notice(): void {
		echo '<div class="notice notice-error"><p>' . esc_html__( 'Persi Headless Account requer JWT Authentication for WP REST API ativo.', 'persi-headless-account' ) . '</p></div>';
	}
}
