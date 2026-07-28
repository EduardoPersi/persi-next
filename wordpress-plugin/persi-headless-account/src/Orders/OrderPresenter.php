<?php

namespace Persi\HeadlessAccount\Orders;

defined( 'ABSPATH' ) || exit;

final class OrderPresenter {
	private const STATUS_LABELS = array(
		'pending'    => 'Aguardando pagamento',
		'processing' => 'Processando',
		'on-hold'    => 'Em espera',
		'completed'  => 'Concluído',
		'cancelled'  => 'Cancelado',
		'refunded'   => 'Reembolsado',
		'failed'     => 'Falhou',
	);

	public static function allowed_statuses(): array {
		return array_keys( self::STATUS_LABELS );
	}

	public function summary( \WC_Order $order ): array {
		return array(
			'id'                  => $order->get_id(),
			'number'              => (string) $order->get_order_number(),
			'dateCreated'         => $this->date( $order->get_date_created() ),
			'status'              => $this->status( $order ),
			'statusLabel'         => $this->status_label( $order ),
			'total'               => $this->money( $order->get_total(), $order->get_currency() ),
			'itemCount'           => (int) $order->get_item_count(),
			'paymentMethod'       => (string) $order->get_payment_method(),
			'paymentMethodTitle'  => (string) $order->get_payment_method_title(),
			'shippingMethodTitle' => (string) $order->get_shipping_method(),
			'canOpen'             => true,
		);
	}

	public function detail( \WC_Order $order ): array {
		$currency = $order->get_currency();
		$fees = 0.0;
		foreach ( $order->get_fees() as $fee ) {
			$fees += (float) $fee->get_total();
		}

		return array(
			'id'          => $order->get_id(),
			'number'      => (string) $order->get_order_number(),
			'dateCreated' => $this->date( $order->get_date_created() ),
			'status'      => $this->status( $order ),
			'statusLabel' => $this->status_label( $order ),
			'items'       => array_values( array_map(
				fn( $item ) => $this->item( $item, $currency ),
				$order->get_items( 'line_item' )
			) ),
			'totals'      => array(
				'subtotal' => $this->money( $order->get_subtotal(), $currency ),
				'discount' => $this->money( $order->get_discount_total(), $currency ),
				'shipping' => $this->money( $order->get_shipping_total(), $currency ),
				'fees'     => $this->money( $fees, $currency ),
				'tax'      => $this->money( $order->get_total_tax(), $currency ),
				'total'    => $this->money( $order->get_total(), $currency ),
			),
			'payment'     => array(
				'method' => (string) $order->get_payment_method(),
				'title'  => (string) $order->get_payment_method_title(),
			),
			'shipping'    => array(
				'methodTitle' => (string) $order->get_shipping_method(),
				'address'     => $this->shipping_address( $order ),
			),
			'billing'      => $this->billing_address( $order ),
			'customerNote' => (string) $order->get_customer_note(),
		);
	}

	private function item( \WC_Order_Item_Product $item, string $currency ): array {
		$product = $item->get_product();
		$image_id = $product instanceof \WC_Product ? $product->get_image_id() : 0;
		if ( ! $image_id && $item->get_product_id() ) {
			$parent_product = wc_get_product( $item->get_product_id() );
			$image_id = $parent_product instanceof \WC_Product ? $parent_product->get_image_id() : 0;
		}
		$src = $image_id ? wp_get_attachment_image_url( $image_id, 'woocommerce_thumbnail' ) : false;
		$alt = $image_id ? get_post_meta( $image_id, '_wp_attachment_image_alt', true ) : '';

		return array(
			'id'          => $item->get_id(),
			'productId'   => $item->get_product_id(),
			'variationId' => $item->get_variation_id(),
			'name'        => (string) $item->get_name(),
			'quantity'    => (int) $item->get_quantity(),
			'subtotal'    => $this->money( $item->get_subtotal(), $currency ),
			'total'       => $this->money( $item->get_total(), $currency ),
			'image'       => array(
				'src' => $src ? esc_url_raw( $src ) : esc_url_raw( wc_placeholder_img_src() ),
				'alt' => is_string( $alt ) && '' !== trim( $alt ) ? trim( $alt ) : (string) $item->get_name(),
			),
		);
	}

	private function money( $value, string $currency ): array {
		$decimal = wc_format_decimal( $value, wc_get_price_decimals() );
		$formatted = html_entity_decode(
			wp_strip_all_tags( wc_price( $decimal, array( 'currency' => $currency ) ) ),
			ENT_QUOTES,
			'UTF-8'
		);
		return array( 'value' => $decimal, 'currency' => $currency, 'formatted' => $formatted );
	}

	private function date( $date ): string {
		return $date instanceof \WC_DateTime ? $date->date( 'c' ) : '';
	}

	private function status( \WC_Order $order ): string {
		$status = (string) $order->get_status();
		return isset( self::STATUS_LABELS[ $status ] ) ? $status : 'failed';
	}

	private function status_label( \WC_Order $order ): string {
		return self::STATUS_LABELS[ $this->status( $order ) ];
	}

	private function shipping_address( \WC_Order $order ): array {
		return array(
			'firstName' => (string) $order->get_shipping_first_name(),
			'lastName'  => (string) $order->get_shipping_last_name(),
			'company'   => (string) $order->get_shipping_company(),
			'address1'  => (string) $order->get_shipping_address_1(),
			'address2'  => (string) $order->get_shipping_address_2(),
			'city'      => (string) $order->get_shipping_city(),
			'state'     => (string) $order->get_shipping_state(),
			'postcode'  => (string) $order->get_shipping_postcode(),
			'country'   => (string) $order->get_shipping_country(),
		);
	}

	private function billing_address( \WC_Order $order ): array {
		return array(
			'firstName' => (string) $order->get_billing_first_name(),
			'lastName'  => (string) $order->get_billing_last_name(),
			'company'   => (string) $order->get_billing_company(),
			'email'     => (string) $order->get_billing_email(),
			'phone'     => (string) $order->get_billing_phone(),
			'address1'  => (string) $order->get_billing_address_1(),
			'address2'  => (string) $order->get_billing_address_2(),
			'city'      => (string) $order->get_billing_city(),
			'state'     => (string) $order->get_billing_state(),
			'postcode'  => (string) $order->get_billing_postcode(),
			'country'   => (string) $order->get_billing_country(),
		);
	}
}
