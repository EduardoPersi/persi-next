<?php
defined( 'ABSPATH' ) || exit;

// Fecha a vitrine WordPress ao público: só o checkout nativo (para onde o
// Next.js manda o cliente de propósito) continua acessível aqui, o resto
// redireciona para o frontend headless. REST API (/wp-json), wp-admin,
// arquivos estáticos (wp-content) e wc-ajax nunca chegam a template_redirect,
// então não precisam de exceção explícita — só o front-end renderizado por
// template passa por aqui.
final class Persi_Headless_Storefront_Lockdown {
	public function register() {
		add_action( 'template_redirect', array( $this, 'maybe_redirect' ), 1 );
	}

	public function maybe_redirect() {
		if ( is_admin() || wp_doing_ajax() || wp_doing_cron() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) return;
		if ( function_exists( 'is_checkout' ) && is_checkout() ) return;
		// Deixa quem administra a loja (ex.: suporte, conferência de pedido)
		// continuar navegando o site normalmente.
		if ( current_user_can( 'manage_woocommerce' ) ) return;

		$target = Persi_Headless_Settings::frontend_url();
		if ( '' === $target ) return;

		wp_redirect( $target, 301 );
		exit;
	}
}
