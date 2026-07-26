<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Bought_Together {
	const META = '_persi_bought_together';

	public function register() {
		add_action( 'add_meta_boxes_product', array( $this, 'add_metabox' ) );
		add_action( 'save_post_product', array( $this, 'save' ) );
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function add_metabox() {
		add_meta_box( 'persi-bought-together', __( 'Persi Headless — Compre junto', 'persi-headless' ), array( $this, 'render' ), 'product', 'normal', 'default' );
	}

	public function render( $post ) {
		$value = get_post_meta( $post->ID, self::META, true );
		$value = is_array( $value ) ? $value : array( 'enabled' => false, 'items' => array() );
		wp_nonce_field( 'persi_bought_together', 'persi_bought_together_nonce' );
		echo '<label><input type="checkbox" name="persi_bt_enabled" value="1" ' . checked( ! empty( $value['enabled'] ), true, false ) . '> ' . esc_html__( 'Ativo', 'persi-headless' ) . '</label>';
		echo '<p><label>' . esc_html__( 'Produtos (um ID por linha; opcionalmente ID|quantidade):', 'persi-headless' ) . '</label></p><textarea class="widefat" rows="6" name="persi_bt_items">';
		foreach ( $value['items'] as $item ) { echo esc_html( $item['product_id'] . '|' . $item['quantity'] ) . "\n"; }
		echo '</textarea><p>' . esc_html__( 'A ordem das linhas define a exibição. A pesquisa nativa de produtos será adicionada em uma versão posterior do painel.', 'persi-headless' ) . '</p>';
	}

	public function save( $post_id ) {
		if ( ! isset( $_POST['persi_bought_together_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['persi_bought_together_nonce'] ) ), 'persi_bought_together' ) || ! current_user_can( 'edit_product', $post_id ) ) {
			return;
		}
		$lines = isset( $_POST['persi_bt_items'] ) ? preg_split( '/\r\n|\r|\n/', sanitize_textarea_field( wp_unslash( $_POST['persi_bt_items'] ) ) ) : array();
		$items = array();
		foreach ( $lines as $line ) {
			list( $id, $quantity ) = array_pad( array_map( 'absint', explode( '|', $line, 2 ) ), 2, 1 );
			$product = $id ? wc_get_product( $id ) : false;
			if ( $id !== $post_id && $product && 'publish' === get_post_status( $id ) ) {
				$items[] = array( 'product_id' => $id, 'quantity' => max( 1, $quantity ) );
			}
		}
		update_post_meta( $post_id, self::META, array( 'enabled' => ! empty( $_POST['persi_bt_enabled'] ), 'items' => array_slice( $items, 0, 20 ) ) );
		Persi_Headless_Cache::invalidate();
	}

	public function register_routes() {
		register_rest_route( 'persi/v1', '/products/(?P<product_id>\d+)/bought-together', array(
			'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'get_items' ), 'permission_callback' => '__return_true',
			'args' => array( 'product_id' => array( 'validate_callback' => static function ( $value ) { return absint( $value ) > 0; } ) ),
		) );
	}

	public function get_items( WP_REST_Request $request ) {
		$product_id = absint( $request['product_id'] );
		$product = wc_get_product( $product_id );
		if ( ! $product || 'publish' !== get_post_status( $product_id ) ) {
			return new WP_Error( 'persi_product_not_found', __( 'Produto não encontrado.', 'persi-headless' ), array( 'status' => 404 ) );
		}
		$cached = Persi_Headless_Cache::get( 'bought_together', $product_id );
		if ( false !== $cached ) { return rest_ensure_response( $cached ); }
		$config = get_post_meta( $product_id, self::META, true );
		$items = array();
		if ( is_array( $config ) && ! empty( $config['enabled'] ) ) {
			foreach ( $config['items'] as $configured ) {
				$item = wc_get_product( absint( $configured['product_id'] ) );
				if ( ! $item || 'publish' !== get_post_status( $item->get_id() ) ) { continue; }
				$image_id = $item->get_image_id();
				$items[] = array(
					'productId' => $item->get_id(), 'name' => $item->get_name(), 'slug' => $item->get_slug(),
					'href' => wp_make_link_relative( Persi_Headless_Settings::frontend_url( 'produto/' . $item->get_slug() ) ),
					'price' => $item->get_price(), 'currencyCode' => get_woocommerce_currency(),
					'image' => array( 'src' => $image_id ? wp_get_attachment_image_url( $image_id, 'woocommerce_thumbnail' ) : '', 'alt' => $image_id ? get_post_meta( $image_id, '_wp_attachment_image_alt', true ) : '' ),
					'inStock' => $item->is_in_stock(), 'purchasable' => $item->is_purchasable(), 'suggestedQuantity' => max( 1, absint( $configured['quantity'] ) ),
				);
			}
		}
		$data = array( 'productId' => $product_id, 'items' => $items );
		Persi_Headless_Cache::set( 'bought_together', $product_id, $data, 60 );
		return rest_ensure_response( $data );
	}
}
