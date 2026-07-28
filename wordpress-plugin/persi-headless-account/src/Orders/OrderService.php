<?php

namespace Persi\HeadlessAccount\Orders;

defined( 'ABSPATH' ) || exit;

final class OrderService {
	public function __construct( private readonly OrderPresenter $presenter ) {}

	public function list( int $user_id, int $page, int $per_page, ?string $status ): array {
		$args = array(
			'customer_id' => $user_id,
			'paginate'    => true,
			'page'        => $page,
			'limit'       => $per_page,
			'orderby'     => 'date',
			'order'       => 'DESC',
			'status'      => null !== $status ? $status : OrderPresenter::allowed_statuses(),
		);
		$result = wc_get_orders( $args );
		$orders = array();
		foreach ( $result->orders as $order ) {
			if ( $order instanceof \WC_Order && $user_id === (int) $order->get_customer_id() ) {
				$orders[] = $this->presenter->summary( $order );
			}
		}
		return array(
			'orders' => $orders,
			'pagination' => array(
				'page'       => $page,
				'perPage'    => $per_page,
				'totalItems' => (int) $result->total,
				'totalPages' => (int) $result->max_num_pages,
			),
		);
	}

	public function find( int $user_id, int $order_id ): ?array {
		$order = wc_get_order( $order_id );
		if ( ! $order instanceof \WC_Order || $user_id !== (int) $order->get_customer_id() ) {
			return null;
		}
		return $this->presenter->detail( $order );
	}
}
