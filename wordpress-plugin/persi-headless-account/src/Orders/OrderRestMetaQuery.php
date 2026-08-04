<?php

namespace Persi\HeadlessAccount\Orders;

defined( 'ABSPATH' ) || exit;

/**
 * O endpoint REST de pedidos do WooCommerce (`wc/v3/orders`), diferente do
 * de produtos, não filtra de verdade por `meta_key`/`meta_value` — ele
 * ignora os dois parâmetros silenciosamente e devolve os pedidos mais
 * recentes, sem erro nenhum. Isso fazia com que a busca de pedido por chave
 * de idempotência e por referência de pagamento (services/woocommerce/
 * orders.ts, lado Next.js) sempre pegasse um pedido qualquer, não o
 * correto — causa raiz do incidente de 2026-08-04 (pedido #30855 e checkout
 * caindo na confirmação de um pedido de outro cliente).
 *
 * Esta classe ensina o WooCommerce a aplicar esses dois parâmetros de
 * verdade, via meta_query, no `WC_Order_Query` que já é usado por baixo do
 * pano.
 */
final class OrderRestMetaQuery {
	public static function register(): void {
		add_filter( 'woocommerce_rest_shop_order_object_query', array( self::class, 'apply_meta_filter' ), 10, 2 );
	}

	public static function apply_meta_filter( array $args, \WP_REST_Request $request ): array {
		$meta_key = $request->get_param( 'meta_key' );
		if ( ! is_string( $meta_key ) || '' === $meta_key ) return $args;

		$meta_value = $request->get_param( 'meta_value' );
		$clause = array( 'key' => $meta_key );
		if ( is_string( $meta_value ) && '' !== $meta_value ) {
			$clause['value'] = $meta_value;
		} else {
			$clause['compare'] = 'EXISTS';
		}

		$args['meta_query'] = isset( $args['meta_query'] ) && is_array( $args['meta_query'] )
			? $args['meta_query']
			: array();
		$args['meta_query'][] = $clause;

		return $args;
	}
}
