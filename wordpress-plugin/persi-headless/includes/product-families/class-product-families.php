<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Product_Families {
	const TAXONOMY = 'persi_product_family';
	const ATTR_META = 'persi_family_attributes';

	public function register() {
		add_action( 'init', array( $this, 'register_taxonomy' ) );
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( self::TAXONOMY . '_add_form_fields', array( $this, 'add_fields' ) );
		add_action( self::TAXONOMY . '_edit_form_fields', array( $this, 'edit_fields' ) );
		add_action( 'created_' . self::TAXONOMY, array( $this, 'save_fields' ) );
		add_action( 'edited_' . self::TAXONOMY, array( $this, 'save_fields' ) );
		add_action( 'save_post_product', array( $this, 'save_product_family' ) );
		add_action( 'set_object_terms', array( $this, 'limit_product_family' ), 10, 6 );
		add_action( 'created_' . self::TAXONOMY, array( 'Persi_Headless_Cache', 'invalidate' ) );
		add_action( 'edited_' . self::TAXONOMY, array( 'Persi_Headless_Cache', 'invalidate' ) );
	}

	public function register_taxonomy() {
		register_taxonomy(
			self::TAXONOMY,
			array( 'product' ),
			array(
				'label'             => __( 'Famílias de produtos', 'persi-headless' ),
				'public'            => false,
				'show_ui'           => true,
				'show_admin_column' => true,
				'show_in_rest'      => false,
				'hierarchical'      => false,
				'meta_box_cb'       => array( $this, 'single_family_metabox' ),
			)
		);
	}

	public function single_family_metabox( $post ) {
		$terms = get_terms( array( 'taxonomy' => self::TAXONOMY, 'hide_empty' => false ) );
		$current = wp_get_object_terms( $post->ID, self::TAXONOMY, array( 'fields' => 'ids' ) );
		wp_nonce_field( 'persi_product_family', 'persi_product_family_nonce' );
		echo '<select name="persi_product_family_id" class="widefat"><option value="0">' .
			esc_html__( 'Sem família', 'persi-headless' ) . '</option>';
		foreach ( is_wp_error( $terms ) ? array() : $terms as $term ) {
			printf( '<option value="%1$d"%2$s>%3$s</option>', absint( $term->term_id ), selected( (int) ( $current[0] ?? 0 ), $term->term_id, false ), esc_html( $term->name ) );
		}
		echo '</select><p>' . esc_html__( 'Cada produto pode pertencer a uma família.', 'persi-headless' ) . '</p>';
	}

	public function save_product_family( $post_id ) {
		if ( ! isset( $_POST['persi_product_family_nonce'], $_POST['persi_product_family_id'] ) ||
			! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['persi_product_family_nonce'] ) ), 'persi_product_family' ) ||
			! current_user_can( 'edit_product', $post_id ) ) {
			return;
		}
		$term_id = absint( $_POST['persi_product_family_id'] );
		wp_set_object_terms( $post_id, $term_id ? array( $term_id ) : array(), self::TAXONOMY, false );
	}

	public function add_fields() {
		echo '<div class="form-field"><label for="persi-family-attributes">' . esc_html__( 'Atributos globais', 'persi-headless' ) .
			'</label><input id="persi-family-attributes" name="persi_family_attributes" type="text" placeholder="pa_bitola, pa_cor">' .
			'<p>' . esc_html__( 'Taxonomias WooCommerce, separadas por vírgula, na ordem de exibição.', 'persi-headless' ) . '</p></div>';
	}

	public function edit_fields( $term ) {
		$attributes = get_term_meta( $term->term_id, self::ATTR_META, true );
		echo '<tr class="form-field"><th><label for="persi-family-attributes">' . esc_html__( 'Atributos globais', 'persi-headless' ) .
			'</label></th><td><input id="persi-family-attributes" name="persi_family_attributes" type="text" value="' .
			esc_attr( implode( ', ', is_array( $attributes ) ? $attributes : array() ) ) . '"><p class="description">' .
			esc_html__( 'Taxonomias WooCommerce, separadas por vírgula, na ordem de exibição.', 'persi-headless' ) . '</p></td></tr>';
	}

	public function save_fields( $term_id ) {
		if ( ! current_user_can( 'manage_woocommerce' ) || ! isset( $_POST['persi_family_attributes'] ) ) {
			return;
		}
		$raw = sanitize_text_field( wp_unslash( $_POST['persi_family_attributes'] ) );
		$attributes = array_values( array_filter( array_map( 'sanitize_key', array_map( 'trim', explode( ',', $raw ) ) ), 'wc_attribute_taxonomy_id_by_name' ) );
		update_term_meta( $term_id, self::ATTR_META, $attributes );
		Persi_Headless_Cache::invalidate();
	}

	public function limit_product_family( $object_id, $terms, $tt_ids, $taxonomy, $append, $old_tt_ids ) {
		if ( self::TAXONOMY !== $taxonomy || 'product' !== get_post_type( $object_id ) || count( $tt_ids ) <= 1 ) {
			return;
		}
		wp_set_object_terms( $object_id, array( (int) reset( $terms ) ), self::TAXONOMY, false );
	}

	public function register_routes() {
		register_rest_route(
			'persi/v1',
			'/products/(?P<product_id>\d+)/family',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_family' ),
				'permission_callback' => '__return_true',
				'args'                => array( 'product_id' => array( 'validate_callback' => static function ( $value ) { return absint( $value ) > 0; } ) ),
			)
		);
	}

	public function get_family( WP_REST_Request $request ) {
		$product_id = absint( $request['product_id'] );
		$cached = Persi_Headless_Cache::get( 'family', $product_id );
		if ( false !== $cached ) {
			return rest_ensure_response( $cached );
		}
		$product = wc_get_product( $product_id );
		if ( ! $product || 'publish' !== get_post_status( $product_id ) ) {
			return new WP_Error( 'persi_product_not_found', __( 'Produto não encontrado.', 'persi-headless' ), array( 'status' => 404 ) );
		}
		$families = wp_get_object_terms( $product_id, self::TAXONOMY );
		if ( is_wp_error( $families ) || empty( $families ) ) {
			return new WP_Error( 'persi_family_not_found', __( 'Família não configurada.', 'persi-headless' ), array( 'status' => 404 ) );
		}
		$family = reset( $families );
		$taxonomies = get_term_meta( $family->term_id, self::ATTR_META, true );
		$taxonomies = is_array( $taxonomies ) ? $taxonomies : array();
		$ids = get_posts(
			array(
				'post_type' => 'product', 'post_status' => 'publish', 'fields' => 'ids',
				'posts_per_page' => 100, 'orderby' => 'ID', 'order' => 'ASC',
				'tax_query' => array( array( 'taxonomy' => self::TAXONOMY, 'field' => 'term_id', 'terms' => array( $family->term_id ) ) ),
			)
		);
		$items = array();
		foreach ( $ids as $id ) {
			$item = wc_get_product( $id );
			if ( ! $item ) { continue; }
			$values = array();
			foreach ( $taxonomies as $taxonomy ) {
				$terms = wc_get_product_terms( $id, $taxonomy, array( 'fields' => 'all' ) );
				if ( ! is_wp_error( $terms ) && ! empty( $terms ) ) {
					$term = reset( $terms );
					$values[ $taxonomy ] = array( 'slug' => $term->slug, 'label' => $term->name );
				}
			}
			$image_id = $item->get_image_id();
			$items[] = array(
				'productId' => $item->get_id(), 'name' => $item->get_name(), 'slug' => $item->get_slug(),
				'href' => wp_make_link_relative( Persi_Headless_Settings::frontend_url( 'produto/' . $item->get_slug() ) ),
				'attributes' => $values,
				'image' => array( 'src' => $image_id ? wp_get_attachment_image_url( $image_id, 'woocommerce_thumbnail' ) : '', 'alt' => $image_id ? get_post_meta( $image_id, '_wp_attachment_image_alt', true ) : '' ),
				'inStock' => $item->is_in_stock(), 'purchasable' => $item->is_purchasable(), 'isCurrent' => $item->get_id() === $product_id,
			);
		}
		$data = array(
			'family' => array(
				'id' => $family->term_id, 'name' => $family->name, 'slug' => $family->slug,
				'attributes' => array_map( static function ( $taxonomy ) { return array( 'taxonomy' => $taxonomy, 'label' => wc_attribute_label( $taxonomy ) ); }, $taxonomies ),
			),
			'currentProductId' => $product_id, 'items' => $items,
		);
		Persi_Headless_Cache::set( 'family', $product_id, $data, 60 );
		return rest_ensure_response( $data );
	}
}
