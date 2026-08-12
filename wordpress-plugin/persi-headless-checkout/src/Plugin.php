<?php

namespace Persi\HeadlessCheckout;

use Persi\HeadlessCheckout\Api\CheckoutTransferController;
use Persi\HeadlessCheckout\Checkout\CartRestorer;
use Persi\HeadlessCheckout\Checkout\CheckoutRedirect;
use Persi\HeadlessCheckout\Checkout\TransferRepository;
use Persi\HeadlessCheckout\Checkout\TransferService;
use Persi\HeadlessCheckout\Security\RequestAuthenticator;
use Persi\HeadlessCheckout\Security\TransferToken;
use Persi\HeadlessCheckout\Support\Configuration;
use Persi\HeadlessCheckout\Support\Logger;
use Persi\HeadlessCheckout\Validation\TransferPayloadValidator;

defined( 'ABSPATH' ) || exit;

final class Plugin {
	public static function boot(): void {
		if ( ! class_exists( 'WooCommerce' ) ) {
			add_action( 'admin_notices', array( self::class, 'render_woocommerce_notice' ) );
			return;
		}

		if ( '' === RequestAuthenticator::resolve_secret() ) {
			add_action( 'admin_notices', array( self::class, 'render_secret_notice' ) );
		}

		$configuration = new Configuration();

		if ( $configuration->has_invalid_configured_cart_url() ) {
			add_action( 'admin_notices', array( self::class, 'render_cart_url_notice' ) );
		}

		$logger         = new Logger();
		$authenticator  = new RequestAuthenticator();
		$validator      = new TransferPayloadValidator();
		$repository     = new TransferRepository( $GLOBALS['wpdb'] );
		$token          = new TransferToken();
		$service        = new TransferService( $repository, $token, $logger );
		$controller     = new CheckoutTransferController(
			$authenticator,
			$validator,
			$service,
			$logger
		);
		$redirect       = new CheckoutRedirect(
			$repository,
			$validator,
			new CartRestorer(),
			$logger,
			$configuration
		);

		add_action( 'rest_api_init', array( $controller, 'register_routes' ) );
		$redirect->register();
	}

	public static function render_woocommerce_notice(): void {
		if ( ! current_user_can( 'activate_plugins' ) ) {
			return;
		}

		echo '<div class="notice notice-error"><p>';
		echo esc_html__( 'Persi Headless Checkout requer que o WooCommerce esteja ativo.', 'persi-headless-checkout' );
		echo '</p></div>';
	}

	public static function render_secret_notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		echo '<div class="notice notice-warning"><p>';
		echo esc_html__( 'Persi Headless Checkout está indisponível até que o segredo HMAC seja configurado.', 'persi-headless-checkout' );
		echo '</p></div>';
	}

	public static function render_cart_url_notice(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			return;
		}

		echo '<div class="notice notice-warning"><p>';
		echo esc_html__( 'Persi Headless Checkout: a URL de retorno do carrinho configurada é inválida.', 'persi-headless-checkout' );
		echo '</p></div>';
	}
}
