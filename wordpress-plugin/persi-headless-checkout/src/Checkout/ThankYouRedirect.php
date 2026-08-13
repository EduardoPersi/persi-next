<?php

namespace Persi\HeadlessCheckout\Checkout;

use Persi\HeadlessCheckout\Support\Configuration;

defined( 'ABSPATH' ) || exit;

// Traz o cliente de volta ao Next.js assim que o pedido é criado pelo
// checkout nativo, com o mesmo padrão de wp_redirect + exit já usado em
// CheckoutRedirect (template_redirect cedo, antes de qualquer HTML ser
// enviado). wp_safe_redirect() não é usado aqui de propósito: o alvo é um
// domínio diferente do WordPress por natureza (Next.js), e a URL já é
// validada de forma estrita por Configuration::confirmation_url() antes de
// chegar aqui.
final class ThankYouRedirect {
	private $configuration;

	public function __construct( Configuration $configuration ) {
		$this->configuration = $configuration;
	}

	public function register(): void {
		add_action( 'template_redirect', array( $this, 'maybe_redirect' ), 20 );
	}

	public function maybe_redirect(): void {
		if ( ! function_exists( 'is_order_received_page' ) || ! is_order_received_page() ) {
			return;
		}

		$confirmation_url = $this->configuration->confirmation_url();

		if ( '' === $confirmation_url ) {
			return;
		}

		$order_id = absint( get_query_var( 'order-received' ) );

		if ( $order_id < 1 ) {
			return;
		}

		$redirect_url = add_query_arg(
			array(
				'provider' => 'woocommerce',
				'orderId'  => $order_id,
			),
			$confirmation_url
		);

		wp_redirect( $redirect_url, 303 );
		exit;
	}
}
