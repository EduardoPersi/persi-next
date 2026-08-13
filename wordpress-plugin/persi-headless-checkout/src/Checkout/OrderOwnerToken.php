<?php

namespace Persi\HeadlessCheckout\Checkout;

defined( 'ABSPATH' ) || exit;

// Copia o Cart-Token guardado na sessão do WooCommerce (ver
// CartRestorer::restore_validated_items) para o pedido assim que ele é
// criado pelo checkout nativo — mesma chave de meta_data que
// services/woocommerce/orders.ts já lê para pedidos criados via Inter/
// PagBank, então a tela de confirmação no Next.js reconhece o dono do
// pedido do mesmo jeito nos dois fluxos.
final class OrderOwnerToken {
	private const SESSION_KEY = 'persi_checkout_owner_token';
	private const ORDER_META_KEY = '_persi_checkout_owner_token';

	public function register(): void {
		add_action( 'woocommerce_checkout_update_order_meta', array( $this, 'attach_owner_token' ) );
	}

	public function attach_owner_token( $order_id ): void {
		if ( null === WC()->session ) {
			return;
		}

		$owner_token = WC()->session->get( self::SESSION_KEY );

		if ( ! is_string( $owner_token ) || '' === $owner_token ) {
			return;
		}

		$order = wc_get_order( $order_id );

		if ( ! $order ) {
			return;
		}

		$order->update_meta_data( self::ORDER_META_KEY, $owner_token );
		$order->save();

		WC()->session->__unset( self::SESSION_KEY );
	}
}
