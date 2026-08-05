<?php
defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Stock_Notifications {
	const ACTION = 'persi_headless_process_stock_notifications';
	const CLEANUP_ACTION = 'persi_headless_cleanup_stock_notifications';
	const GROUP = 'persi-headless-stock-notifications';
	const NEUTRAL_MESSAGE = 'Se os dados forem válidos, você receberá as instruções por e-mail.';

	public function register() {
		foreach ( array( 'class-repository.php', 'class-configuration.php', 'class-authenticator.php', 'class-validator.php' ) as $file ) require_once __DIR__ . '/' . $file;
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( 'woocommerce_product_set_stock_status', array( $this, 'stock_status_changed' ), 10, 3 );
		add_action( 'woocommerce_variation_set_stock_status', array( $this, 'variation_stock_status_changed' ), 10, 3 );
		add_action( self::ACTION, array( $this, 'process_batch' ), 10, 2 );
		add_action( self::CLEANUP_ACTION, array( $this, 'cleanup' ) );
		$this->ensure_cleanup();
	}

	public function register_routes() {
		$routes = array(
			'/stock-notifications/subscribe' => 'subscribe',
			'/stock-notifications/resend-confirmation' => 'resend_confirmation',
			'/stock-notifications/confirm' => 'confirm',
			'/stock-notifications/unsubscribe' => 'unsubscribe',
		);
		foreach ( $routes as $route => $callback ) register_rest_route( 'persi/v1', $route, array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => array( $this, $callback ), 'permission_callback' => '__return_true' ) );
		register_rest_route( 'persi/v1', '/stock-notifications/confirm/(?P<token>[A-Za-z0-9_-]{40,128})', array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'legacy_confirm_link' ), 'permission_callback' => '__return_true' ) );
		register_rest_route( 'persi/v1', '/stock-notifications/unsubscribe/(?P<token>[A-Za-z0-9_-]{40,128})', array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'legacy_unsubscribe_link' ), 'permission_callback' => '__return_true' ) );
	}
	public function legacy_confirm_link( WP_REST_Request $request ) { return $this->legacy_redirect( '/confirmar-notificacao', $request['token'] ); }
	public function legacy_unsubscribe_link( WP_REST_Request $request ) { return $this->legacy_redirect( '/remover-notificacao', $request['token'] ); }
	private function legacy_redirect( $path, $token ) { $response = $this->response( array( 'message' => 'Redirecionando.' ), 302 ); $response->header( 'Location', add_query_arg( 'token', $token, Persi_Headless_Stock_Configuration::frontend_url() . $path ) ); return $response; }

	private function response( $data, $status = 200, $retry = null ) {
		$response = new WP_REST_Response( $data, $status );
		foreach ( array( 'Cache-Control' => 'private, no-store, no-cache, max-age=0', 'Pragma' => 'no-cache', 'Referrer-Policy' => 'no-referrer', 'X-Content-Type-Options' => 'nosniff' ) as $name => $value ) $response->header( $name, $value );
		if ( $retry ) $response->header( 'Retry-After', (string) $retry );
		return $response;
	}
	private function neutral() { return $this->response( array( 'code' => 'accepted', 'message' => __( self::NEUTRAL_MESSAGE, 'persi-headless' ) ), 202 ); }
	private function authenticate( WP_REST_Request $request, $path ) {
		if ( strlen( $request->get_body() ) > 4096 || false === strpos( strtolower( (string) $request->get_header( 'content-type' ) ), 'application/json' ) ) return new WP_Error( 'invalid_request', 'Dados inválidos.', array( 'status' => 400 ) );
		return ( new Persi_Headless_Stock_Authenticator() )->authenticate( $request, '/wp-json/persi/v1' . $path );
	}

	public function subscribe( WP_REST_Request $request ) {
		global $wpdb;
		$auth = $this->authenticate( $request, '/stock-notifications/subscribe' );
		if ( is_wp_error( $auth ) ) return $this->response( array( 'message' => 'Não autorizado.' ), (int) ( $auth->get_error_data()['status'] ?? 401 ) );
		$data = ( new Persi_Headless_Stock_Validator() )->validate( $request->get_body(), $auth['origin'] );
		if ( ! $data ) return $this->neutral();
		update_post_meta( $data['product_id'], '_persi_headless_stock_status_' . absint( $data['variation_id'] ), 'outofstock' );
		$email_hash = hash_hmac( 'sha256', $data['email'], wp_salt( 'secure_auth' ) );
		if ( $this->rate_limited( 'subscribe', $email_hash . '|' . $data['product_id'], 3, 1800 ) || $this->rate_limited( 'subscribe_ip', $this->client_ip_hash(), 5, 600 ) ) return $this->neutral();
		$encrypted = Persi_Headless_Stock_Repository::encrypt_email( $data['email'] );
		if ( false === $encrypted ) return $this->response( array( 'code' => 'unavailable', 'message' => 'Serviço temporariamente indisponível.' ), 503 );
		$table = Persi_Headless_Stock_Repository::table();
		$active = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE product_id=%d AND variation_id=%d AND email_hash=%s AND status IN ('pending','confirmed','queued','sending') ORDER BY id DESC LIMIT 1", $data['product_id'], $data['variation_id'], $email_hash ) );
		$now = current_time( 'mysql', true );
		if ( $active ) {
			if ( 'pending' === $active->status ) $this->send_confirmation( $active, $data['email'] );
			return $this->neutral();
		}
		$cycle = 1 + (int) $wpdb->get_var( $wpdb->prepare( "SELECT COALESCE(MAX(notification_cycle),0) FROM {$table} WHERE product_id=%d AND variation_id=%d AND email_hash=%s", $data['product_id'], $data['variation_id'], $email_hash ) );
		$confirmation = wp_generate_password( 48, false, false );
		$unsubscribe = wp_generate_password( 48, false, false );
		$double = (bool) Persi_Headless_Settings::get( 'double_opt_in', true );
		$inserted = $wpdb->insert( $table, array(
			'product_id' => $data['product_id'], 'variation_id' => $data['variation_id'], 'email_hash' => $email_hash, 'email_encrypted' => $encrypted,
			'status' => $double ? 'pending' : 'confirmed', 'confirmation_token' => hash( 'sha256', $confirmation ), 'unsubscribe_token' => hash( 'sha256', $unsubscribe ),
			'created_at' => $now, 'confirmed_at' => $double ? null : $now, 'consent_given' => 1, 'consent_at' => $now,
			'privacy_policy_version' => $data['policy_version'], 'privacy_policy_url' => $data['policy_url'], 'consent_origin' => $auth['origin'],
			'consent_ip_hash' => $this->client_ip_hash(), 'consent_user_agent_hash' => $this->user_agent_hash(), 'notification_cycle' => $cycle,
			'expires_at' => gmdate( 'Y-m-d H:i:s', time() + $this->retention_days( $double ? 'pending' : 'confirmed' ) * DAY_IN_SECONDS ), 'updated_at' => $now,
		) );
		if ( $inserted && $double ) {
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id=%d", $wpdb->insert_id ) );
			$this->send_confirmation( $row, $data['email'], $confirmation );
		}
		return $this->neutral();
	}

	public function resend_confirmation( WP_REST_Request $request ) {
		global $wpdb;
		$auth = $this->authenticate( $request, '/stock-notifications/resend-confirmation' );
		if ( is_wp_error( $auth ) ) return $this->response( array( 'message' => 'Não autorizado.' ), (int) ( $auth->get_error_data()['status'] ?? 401 ) );
		$body = json_decode( $request->get_body(), true );
		if ( ! is_array( $body ) || array_diff( array_keys( $body ), array( 'email', 'productId', 'variationId' ) ) || array_diff( array( 'email', 'productId', 'variationId' ), array_keys( $body ) ) ) return $this->neutral();
		$email = sanitize_email( $body['email'] ?? '' );
		$hash = hash_hmac( 'sha256', strtolower( $email ), wp_salt( 'secure_auth' ) );
		if ( $this->rate_limited( 'resend', $hash, 2, HOUR_IN_SECONDS ) ) return $this->neutral();
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM " . Persi_Headless_Stock_Repository::table() . " WHERE email_hash=%s AND product_id=%d AND variation_id=%d AND status='pending' ORDER BY id DESC LIMIT 1", $hash, absint( $body['productId'] ?? 0 ), absint( $body['variationId'] ?? 0 ) ) );
		if ( $row && $email ) $this->send_confirmation( $row, strtolower( $email ) );
		return $this->neutral();
	}

	private function send_confirmation( $row, $email, $token = null ) {
		global $wpdb;
		if ( ! $row || (int) $row->confirmation_attempts >= 3 ) return false;
		$last = $row->last_confirmation_sent_at ? strtotime( $row->last_confirmation_sent_at . ' UTC' ) : 0;
		$wait = 60 * ( 2 ** (int) $row->confirmation_attempts );
		if ( $last && time() - $last < $wait ) return false;
		$token = $token ?: wp_generate_password( 48, false, false );
		$url = add_query_arg( 'token', $token, Persi_Headless_Stock_Configuration::frontend_url() . '/confirmar-notificacao' );
		$sent = wp_mail( $email, __( 'Confirme seu aviso de estoque', 'persi-headless' ), sprintf( __( "Confirme seu aviso acessando:\n%s", 'persi-headless' ), esc_url_raw( $url ) ) );
		if ( ! $sent ) update_option( 'persi_headless_stock_last_failure', array( 'code' => 'mail_failed', 'at' => current_time( 'mysql', true ) ), false );
		$wpdb->update( Persi_Headless_Stock_Repository::table(), array(
			'confirmation_token' => hash( 'sha256', $token ), 'last_confirmation_sent_at' => current_time( 'mysql', true ),
			'confirmation_attempts' => (int) $row->confirmation_attempts + 1, 'failure_code' => $sent ? null : 'mail_failed', 'updated_at' => current_time( 'mysql', true ),
		), array( 'id' => $row->id, 'status' => 'pending' ) );
		return $sent;
	}

	public function confirm( WP_REST_Request $request ) {
		global $wpdb;
		$auth = $this->authenticate( $request, '/stock-notifications/confirm' );
		if ( is_wp_error( $auth ) ) return $this->response( array( 'message' => 'Não autorizado.' ), (int) ( $auth->get_error_data()['status'] ?? 401 ) );
		$body = json_decode( $request->get_body(), true ); $token = is_array( $body ) && array_keys( $body ) === array( 'token' ) ? (string) $body['token'] : '';
		if ( $this->rate_limited( 'confirm_token', hash( 'sha256', $token ), 20, 600 ) ) return $this->response( array( 'message' => 'Não foi possível concluir esta solicitação.' ), 429, 600 );
		$now = current_time( 'mysql', true );
		$updated = preg_match( '/^[A-Za-z0-9_-]{40,128}$/', $token ) ? $wpdb->query( $wpdb->prepare( "UPDATE " . Persi_Headless_Stock_Repository::table() . " SET status='confirmed',confirmed_at=%s,confirmation_token=NULL,expires_at=%s,updated_at=%s WHERE confirmation_token=%s AND status='pending' AND expires_at>%s", $now, gmdate( 'Y-m-d H:i:s', time() + $this->retention_days( 'confirmed' ) * DAY_IN_SECONDS ), $now, hash( 'sha256', $token ), $now ) ) : 0;
		return $this->response( array( 'message' => $updated ? 'Seu aviso foi confirmado.' : 'Não foi possível concluir esta solicitação.' ), $updated ? 200 : 400 );
	}

	public function unsubscribe( WP_REST_Request $request ) {
		global $wpdb;
		$auth = $this->authenticate( $request, '/stock-notifications/unsubscribe' );
		if ( is_wp_error( $auth ) ) return $this->response( array( 'message' => 'Não autorizado.' ), (int) ( $auth->get_error_data()['status'] ?? 401 ) );
		$body = json_decode( $request->get_body(), true ); $token = is_array( $body ) && array_keys( $body ) === array( 'token' ) ? (string) $body['token'] : '';
		if ( $this->rate_limited( 'unsubscribe_token', hash( 'sha256', $token ), 20, 600 ) ) return $this->response( array( 'message' => 'Não foi possível concluir esta solicitação.' ), 429, 600 );
		$now = current_time( 'mysql', true );
		$updated = preg_match( '/^[A-Za-z0-9_-]{40,128}$/', $token ) ? $wpdb->query( $wpdb->prepare( "UPDATE " . Persi_Headless_Stock_Repository::table() . " SET status='unsubscribed',unsubscribe_token='',expires_at=%s,updated_at=%s WHERE unsubscribe_token=%s AND status NOT IN ('unsubscribed','anonymized')", gmdate( 'Y-m-d H:i:s', time() + $this->retention_days( 'unsubscribed' ) * DAY_IN_SECONDS ), $now, hash( 'sha256', $token ) ) ) : 0;
		return $this->response( array( 'message' => $updated ? 'Seu aviso foi cancelado.' : 'Não foi possível concluir esta solicitação.' ), $updated ? 200 : 400 );
	}

	public function stock_status_changed( $product_id, $status, $product ) { $this->transition( $product_id, 0, $status ); }
	public function variation_stock_status_changed( $variation_id, $status, $variation ) { $this->transition( $variation->get_parent_id(), $variation_id, $status ); }
	private function transition( $product_id, $variation_id, $status ) {
		$key = '_persi_headless_stock_status_' . absint( $variation_id );
		$previous = get_post_meta( $product_id, $key, true );
		update_post_meta( $product_id, $key, $status );
		if ( 'outofstock' !== $previous || 'instock' !== $status ) return;
		global $wpdb; $now = current_time( 'mysql', true );
		$wpdb->query( $wpdb->prepare( "UPDATE " . Persi_Headless_Stock_Repository::table() . " SET status='queued',queued_at=%s,updated_at=%s WHERE product_id=%d AND variation_id=%d AND status='confirmed' AND consent_given=1 AND anonymized_at IS NULL", $now, $now, $product_id, $variation_id ) );
		$this->schedule( $product_id, $variation_id, 30 );
	}

	private function schedule( $product_id, $variation_id, $delay ) {
		$args = array( absint( $product_id ), absint( $variation_id ) );
		if ( ! function_exists( 'as_schedule_single_action' ) ) { update_option( 'persi_headless_stock_last_failure', array( 'code' => 'action_scheduler_unavailable', 'at' => current_time( 'mysql', true ) ), false ); return false; }
		if ( ! as_has_scheduled_action( self::ACTION, $args, self::GROUP ) ) as_schedule_single_action( time() + $delay, self::ACTION, $args, self::GROUP, true );
		return true;
	}

	public function process_batch( $product_id, $variation_id ) {
		global $wpdb; $table = Persi_Headless_Stock_Repository::table();
		$product = wc_get_product( $variation_id ?: $product_id );
		if ( ! $product || 'publish' !== get_post_status( $product_id ) || ! $product->is_in_stock() || ! $product->is_purchasable() ) {
			$wpdb->query( $wpdb->prepare( "UPDATE {$table} SET status='confirmed',queued_at=NULL,failure_code='product_out_of_stock',updated_at=%s WHERE product_id=%d AND variation_id=%d AND status='queued'", current_time( 'mysql', true ), $product_id, $variation_id ) );
			return;
		}
		$limit = min( 100, max( 1, absint( Persi_Headless_Settings::get( 'batch_size', 25 ) ) ) );
		$ids = $wpdb->get_col( $wpdb->prepare( "SELECT id FROM {$table} WHERE product_id=%d AND variation_id=%d AND status='queued' AND attempts<3 ORDER BY id ASC LIMIT %d", $product_id, $variation_id, $limit ) );
		foreach ( $ids as $id ) {
			$current_product = wc_get_product( $variation_id ?: $product_id );
			if ( ! $current_product || ! $current_product->is_in_stock() || ! $current_product->is_purchasable() ) {
				$wpdb->query( $wpdb->prepare( "UPDATE {$table} SET status='confirmed',queued_at=NULL,failure_code='product_out_of_stock',updated_at=%s WHERE product_id=%d AND variation_id=%d AND status='queued'", current_time( 'mysql', true ), $product_id, $variation_id ) );
				return;
			}
			$claimed = $wpdb->query( $wpdb->prepare( "UPDATE {$table} SET status='sending',updated_at=%s WHERE id=%d AND status='queued'", current_time( 'mysql', true ), $id ) );
			if ( 1 !== $claimed ) continue;
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id=%d", $id ) );
			$email = Persi_Headless_Stock_Repository::decrypt_email( $row->email_encrypted );
			$unsubscribe = wp_generate_password( 48, false, false );
			$url = add_query_arg( 'token', $unsubscribe, Persi_Headless_Stock_Configuration::frontend_url() . '/remover-notificacao' );
			$message = $this->email_template( $product, $url );
			$subject = apply_filters( 'persi_headless_stock_mail_subject', sprintf( __( '%s voltou ao estoque', 'persi-headless' ), $product->get_name() ), $product );
			$headers = array( 'Content-Type: text/html; charset=UTF-8' );
			$from = apply_filters( 'persi_headless_stock_mail_from', '' );
			$name = apply_filters( 'persi_headless_stock_mail_from_name', 'Persi Materiais' );
			if ( is_email( $from ) ) $headers[] = 'From: ' . sanitize_text_field( $name ) . ' <' . sanitize_email( $from ) . '>';
			$sent = $email && wp_mail( $email, $subject, $message, $headers );
			if ( ! $sent ) update_option( 'persi_headless_stock_last_failure', array( 'code' => $email ? 'mail_failed' : 'decrypt_failed', 'at' => current_time( 'mysql', true ) ), false );
			$attempts = (int) $row->attempts + 1; $now = current_time( 'mysql', true );
			$wpdb->update( $table, array(
				'status' => $sent ? 'sent' : ( $attempts >= 3 ? 'failed' : 'queued' ), 'unsubscribe_token' => hash( 'sha256', $unsubscribe ),
				'sent_at' => $sent ? $now : null, 'last_notification_at' => $sent ? $now : null, 'attempts' => $attempts,
				'failure_code' => $sent ? null : ( $email ? 'mail_failed' : 'decrypt_failed' ), 'last_error' => $sent ? null : ( $email ? 'mail_failed' : 'decrypt_failed' ),
				'expires_at' => gmdate( 'Y-m-d H:i:s', time() + $this->retention_days( $sent ? 'sent' : 'failed' ) * DAY_IN_SECONDS ), 'updated_at' => $now,
			), array( 'id' => $id, 'status' => 'sending' ) );
			if ( ! $sent && $attempts < 3 ) $this->schedule( $product_id, $variation_id, 60 * ( 2 ** $attempts ) );
		}
		$remaining = (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE product_id=%d AND variation_id=%d AND status='queued' AND attempts<3", $product_id, $variation_id ) );
		if ( $remaining > 0 ) $this->schedule( $product_id, $variation_id, 30 );
	}

	private function email_template( $product, $unsubscribe_url ) {
		$product_url = Persi_Headless_Stock_Configuration::frontend_url() . '/' . $product->get_slug();
		$image = wp_get_attachment_image_url( $product->get_image_id(), 'woocommerce_thumbnail' );
		$price = wp_strip_all_tags( wc_price( $product->get_price() ) );
		$pix = apply_filters( 'persi_headless_stock_pix_price', '', $product );
		$logo = apply_filters( 'persi_headless_stock_mail_logo', '', $product );
		$html = '<div style="background:#f4f7fb;padding:24px"><div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;padding:28px;font-family:Arial,sans-serif;color:#071f5c">';
		$html .= $logo ? '<img src="' . esc_url( $logo ) . '" alt="Persi Materiais" style="max-width:190px;height:auto">' : '<h1>Persi Materiais</h1>';
		$html .= '<h2>' . esc_html( $product->get_name() ) . ' voltou ao estoque</h2>';
		if ( $image ) $html .= '<img src="' . esc_url( $image ) . '" alt="' . esc_attr( $product->get_name() ) . '" style="width:100%;max-width:320px;height:auto">';
		$html .= '<p style="font-size:20px;font-weight:bold">' . esc_html( $price ) . '</p>';
		if ( is_numeric( $pix ) ) $html .= '<p>' . esc_html( wp_strip_all_tags( wc_price( $pix ) ) ) . ' no Pix</p>';
		$html .= '<p><a href="' . esc_url( $product_url ) . '" style="display:inline-block;background:#ff6a00;color:#fff;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:bold">Comprar agora</a></p>';
		$html .= '<p>A disponibilidade é limitada e não representa reserva de estoque.</p><hr><p>Persi Materiais · WhatsApp (11) 3964-8294</p>';
		$html .= '<p><a href="' . esc_url( Persi_Headless_Stock_Configuration::frontend_url() . '/politica-de-privacidade-e-seguranca' ) . '">Política de privacidade</a> · <a href="' . esc_url( $unsubscribe_url ) . '">Cancelar este aviso</a></p></div></div>';
		return apply_filters( 'persi_headless_stock_mail_template', $html, $product, $unsubscribe_url );
	}

	private function rate_limited( $scope, $identity, $max, $ttl ) {
		$key = 'persi_stock_rate_' . substr( hash_hmac( 'sha256', $scope . '|' . $identity, Persi_Headless_Stock_Configuration::secret() ), 0, 40 );
		$count = absint( get_transient( $key ) ); set_transient( $key, $count + 1, $ttl ); return $count >= $max;
	}
	private function client_ip_hash() {
		$ip = (string) ( $_SERVER['REMOTE_ADDR'] ?? '' );
		$trust_proxy = defined( 'PERSI_HEADLESS_STOCK_TRUST_PROXY_HEADERS' ) && true === constant( 'PERSI_HEADLESS_STOCK_TRUST_PROXY_HEADERS' );
		$trusted_remote = in_array( $ip, Persi_Headless_Stock_Configuration::trusted_proxy_ips(), true );
		if ( $trust_proxy && $trusted_remote && ! empty( $_SERVER['HTTP_CF_CONNECTING_IP'] ) && filter_var( $_SERVER['HTTP_CF_CONNECTING_IP'], FILTER_VALIDATE_IP ) ) $ip = $_SERVER['HTTP_CF_CONNECTING_IP'];
		return '' === $ip ? null : hash_hmac( 'sha256', 'ip|' . $ip, Persi_Headless_Stock_Configuration::secret() );
	}
	private function user_agent_hash() { $ua = substr( (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ), 0, 512 ); return '' === $ua ? null : hash_hmac( 'sha256', 'ua|' . $ua, Persi_Headless_Stock_Configuration::secret() ); }
	private function retention_days( $status ) { $retention = Persi_Headless_Settings::get( 'retention', array() ); $defaults = array( 'pending' => 7, 'sent' => 90, 'failed' => 30, 'unsubscribed' => 30, 'confirmed' => 180 ); return min( 365, max( 1, absint( $retention[ $status ] ?? $defaults[ $status ] ?? 30 ) ) ); }
	private function ensure_cleanup() {
		if ( function_exists( 'as_schedule_recurring_action' ) && ! as_has_scheduled_action( self::CLEANUP_ACTION, array(), self::GROUP ) ) as_schedule_recurring_action( time() + HOUR_IN_SECONDS, DAY_IN_SECONDS, self::CLEANUP_ACTION, array(), self::GROUP, true );
		elseif ( ! wp_next_scheduled( self::CLEANUP_ACTION ) ) wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::CLEANUP_ACTION );
	}
	public function cleanup() { Persi_Headless_Stock_Repository::anonymize_expired(); global $wpdb; $wpdb->query( $wpdb->prepare( 'DELETE FROM ' . Persi_Headless_Stock_Repository::nonce_table() . ' WHERE expires_at <= %s', current_time( 'mysql', true ) ) ); }
}
