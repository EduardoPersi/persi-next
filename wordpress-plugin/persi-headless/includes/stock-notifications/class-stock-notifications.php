<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Stock_Notifications {
	const ACTION = 'persi_headless_process_stock_notifications';
	const GROUP  = 'persi-headless-stock-notifications';

	public function register() {
		require_once __DIR__ . '/class-repository.php';
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( 'woocommerce_product_set_stock_status', array( $this, 'stock_status_changed' ), 10, 3 );
		add_action( 'woocommerce_variation_set_stock_status', array( $this, 'variation_stock_status_changed' ), 10, 3 );
		add_action( self::ACTION, array( $this, 'process_batch' ), 10, 2 );
	}

	public function register_routes() {
		register_rest_route( 'persi/v1', '/stock-notifications/subscribe', array(
			'methods' => WP_REST_Server::CREATABLE, 'callback' => array( $this, 'subscribe' ), 'permission_callback' => '__return_true',
		) );
		register_rest_route( 'persi/v1', '/stock-notifications/confirm/(?P<token>[A-Za-z0-9_-]{40,})', array(
			'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'confirm' ), 'permission_callback' => '__return_true',
		) );
		register_rest_route( 'persi/v1', '/stock-notifications/unsubscribe/(?P<token>[A-Za-z0-9_-]{40,})', array(
			'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'unsubscribe' ), 'permission_callback' => '__return_true',
		) );
	}

	private function neutral_response() {
		return new WP_REST_Response( array( 'code' => 'accepted', 'message' => __( 'Se os dados forem válidos, você receberá as instruções por e-mail.', 'persi-headless' ) ), 202 );
	}

	public function subscribe( WP_REST_Request $request ) {
		global $wpdb;
		$content_length = absint( $request->get_header( 'content-length' ) );
		if ( $content_length > 2048 || false === strpos( strtolower( $request->get_header( 'content-type' ) ), 'application/json' ) ) {
			return new WP_Error( 'persi_invalid_request', __( 'Solicitação inválida.', 'persi-headless' ), array( 'status' => 400 ) );
		}
		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) || ! empty( $payload['website'] ) ) { return $this->neutral_response(); }
		$email = isset( $payload['email'] ) ? sanitize_email( $payload['email'] ) : '';
		$product_id = absint( $payload['productId'] ?? 0 );
		$variation_id = absint( $payload['variationId'] ?? 0 );
		$product = wc_get_product( $product_id );
		$target = $variation_id ? wc_get_product( $variation_id ) : $product;
		if ( ! is_email( $email ) || ! $product || 'publish' !== get_post_status( $product_id ) || ! $target || $target->is_in_stock() || ( $variation_id && (int) $target->get_parent_id() !== $product_id ) ) {
			return new WP_Error( 'persi_invalid_subscription', __( 'Não foi possível cadastrar o aviso para este produto.', 'persi-headless' ), array( 'status' => 400 ) );
		}
		$ip_hash = hash_hmac( 'sha256', (string) ( $_SERVER['REMOTE_ADDR'] ?? 'unknown' ), wp_salt( 'nonce' ) );
		$rate_key = 'persi_rate_' . substr( $ip_hash, 0, 32 );
		$count = absint( get_transient( $rate_key ) );
		if ( $count >= 5 ) { return new WP_Error( 'persi_rate_limited', __( 'Muitas tentativas. Aguarde e tente novamente.', 'persi-headless' ), array( 'status' => 429 ) ); }
		set_transient( $rate_key, $count + 1, 10 * MINUTE_IN_SECONDS );
		$encrypted = Persi_Headless_Stock_Repository::encrypt_email( strtolower( $email ) );
		if ( false === $encrypted ) {
			return new WP_Error( 'persi_encryption_unavailable', __( 'Serviço temporariamente indisponível.', 'persi-headless' ), array( 'status' => 503 ) );
		}
		$confirmation = wp_generate_password( 48, false, false );
		$unsubscribe  = wp_generate_password( 48, false, false );
		$double_opt_in = (bool) Persi_Headless_Settings::get( 'double_opt_in', true );
		$inserted = $wpdb->query( $wpdb->prepare(
			'INSERT IGNORE INTO ' . Persi_Headless_Stock_Repository::table() . ' (product_id,variation_id,email_hash,email_encrypted,status,confirmation_token,unsubscribe_token,created_at,confirmed_at) VALUES (%d,%d,%s,%s,%s,%s,%s,%s,%s)',
			$product_id, $variation_id, hash_hmac( 'sha256', strtolower( $email ), wp_salt( 'secure_auth' ) ), $encrypted,
			$double_opt_in ? 'pending' : 'confirmed', hash( 'sha256', $confirmation ), hash( 'sha256', $unsubscribe ), current_time( 'mysql', true ),
			$double_opt_in ? null : current_time( 'mysql', true )
		) );
		if ( $inserted && $double_opt_in ) {
			$url = rest_url( 'persi/v1/stock-notifications/confirm/' . rawurlencode( $confirmation ) );
			wp_mail( $email, __( 'Confirme seu aviso de estoque', 'persi-headless' ), sprintf( __( "Confirme seu cadastro acessando:\n%s", 'persi-headless' ), esc_url_raw( $url ) ) );
		}
		return $this->neutral_response();
	}

	public function confirm( WP_REST_Request $request ) {
		global $wpdb;
		$updated = $wpdb->update( Persi_Headless_Stock_Repository::table(), array( 'status' => 'confirmed', 'confirmed_at' => current_time( 'mysql', true ), 'confirmation_token' => null ), array( 'confirmation_token' => hash( 'sha256', $request['token'] ), 'status' => 'pending' ), array( '%s', '%s', '%s' ), array( '%s', '%s' ) );
		return new WP_REST_Response( array( 'code' => $updated ? 'confirmed' : 'invalid_or_used', 'message' => $updated ? __( 'Aviso confirmado.', 'persi-headless' ) : __( 'Link inválido ou já utilizado.', 'persi-headless' ) ), $updated ? 200 : 410 );
	}

	public function unsubscribe( WP_REST_Request $request ) {
		global $wpdb;
		$updated = $wpdb->update( Persi_Headless_Stock_Repository::table(), array( 'status' => 'unsubscribed' ), array( 'unsubscribe_token' => hash( 'sha256', $request['token'] ) ), array( '%s' ), array( '%s' ) );
		return new WP_REST_Response( array( 'code' => 'unsubscribed', 'message' => __( 'Inscrição cancelada.', 'persi-headless' ) ), $updated ? 200 : 410 );
	}

	public function stock_status_changed( $product_id, $status, $product ) {
		if ( 'instock' === $status ) { $this->schedule( $product_id, 0 ); }
	}

	public function variation_stock_status_changed( $variation_id, $status, $variation ) {
		if ( 'instock' === $status ) { $this->schedule( $variation->get_parent_id(), $variation_id ); }
	}

	private function schedule( $product_id, $variation_id ) {
		$args = array( absint( $product_id ), absint( $variation_id ) );
		if ( function_exists( 'as_has_scheduled_action' ) && function_exists( 'as_schedule_single_action' ) && ! as_has_scheduled_action( self::ACTION, $args, self::GROUP ) ) {
			as_schedule_single_action( time() + 30, self::ACTION, $args, self::GROUP, true );
		}
	}

	public function process_batch( $product_id, $variation_id ) {
		global $wpdb;
		$lock = 'persi_stock_lock_' . absint( $product_id ) . '_' . absint( $variation_id );
		if ( get_transient( $lock ) ) { return; }
		set_transient( $lock, 1, 5 * MINUTE_IN_SECONDS );
		$limit = min( 100, max( 1, absint( Persi_Headless_Settings::get( 'batch_size', 25 ) ) ) );
		$rows = $wpdb->get_results( $wpdb->prepare(
			'SELECT * FROM ' . Persi_Headless_Stock_Repository::table() . ' WHERE product_id=%d AND variation_id=%d AND status=%s AND attempts < 3 ORDER BY id ASC LIMIT %d',
			$product_id, $variation_id, 'confirmed', $limit
		) );
		$product = wc_get_product( $variation_id ?: $product_id );
		foreach ( $rows as $row ) {
			$email = Persi_Headless_Stock_Repository::decrypt_email( $row->email_encrypted );
			$unsubscribe = wp_generate_password( 48, false, false );
			$unsubscribe_url = rest_url( 'persi/v1/stock-notifications/unsubscribe/' . rawurlencode( $unsubscribe ) );
			$product_url = Persi_Headless_Settings::frontend_url( 'produto/' . $product->get_slug() );
			$message = sprintf(
				'<h1>%1$s</h1><p>%2$s</p><p><a href="%3$s">%4$s</a></p><p>%5$s</p><p><a href="%6$s">%7$s</a></p>',
				esc_html__( 'Persi Materiais', 'persi-headless' ),
				esc_html( sprintf( __( '%s está disponível novamente.', 'persi-headless' ), $product ? $product->get_name() : '' ) ),
				esc_url( $product_url ),
				esc_html__( 'Ver produto', 'persi-headless' ),
				esc_html__( 'A disponibilidade é limitada e não representa reserva de estoque.', 'persi-headless' ),
				esc_url( $unsubscribe_url ),
				esc_html__( 'Cancelar este aviso', 'persi-headless' )
			);
			$wpdb->update( Persi_Headless_Stock_Repository::table(), array( 'unsubscribe_token' => hash( 'sha256', $unsubscribe ) ), array( 'id' => $row->id ), array( '%s' ), array( '%d' ) );
			$sent = $email && $product && wp_mail( $email, sprintf( __( '%s voltou ao estoque', 'persi-headless' ), $product->get_name() ), $message, array( 'Content-Type: text/html; charset=UTF-8' ) );
			$attempts = (int) $row->attempts + 1;
			$wpdb->update( Persi_Headless_Stock_Repository::table(), array( 'status' => $sent ? 'sent' : ( $attempts >= 3 ? 'failed' : 'confirmed' ), 'sent_at' => $sent ? current_time( 'mysql', true ) : null, 'attempts' => $attempts, 'last_error' => $sent ? null : 'mail_failed' ), array( 'id' => $row->id, 'status' => 'confirmed' ) );
		}
		delete_transient( $lock );
		if ( count( $rows ) > 0 ) { $this->schedule( $product_id, $variation_id ); }
	}
}
