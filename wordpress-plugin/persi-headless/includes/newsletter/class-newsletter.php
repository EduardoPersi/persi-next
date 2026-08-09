<?php
defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Newsletter {
	const CLEANUP_ACTION = 'persi_headless_cleanup_newsletter';
	const GROUP = 'persi-headless-newsletter';
	const NEUTRAL_MESSAGE = 'Se os dados forem válidos, você receberá as instruções por e-mail.';

	public function register() {
		foreach ( array( 'class-repository.php', 'class-configuration.php', 'class-authenticator.php', 'class-validator.php' ) as $file ) require_once __DIR__ . '/' . $file;
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( self::CLEANUP_ACTION, array( $this, 'cleanup' ) );
		$this->ensure_cleanup();
	}

	public function register_routes() {
		$routes = array(
			'/newsletter/subscribe' => 'subscribe',
			'/newsletter/resend-confirmation' => 'resend_confirmation',
			'/newsletter/confirm' => 'confirm',
			'/newsletter/unsubscribe' => 'unsubscribe',
		);
		foreach ( $routes as $route => $callback ) register_rest_route( 'persi/v1', $route, array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => array( $this, $callback ), 'permission_callback' => '__return_true' ) );
		register_rest_route( 'persi/v1', '/newsletter/confirm/(?P<token>[A-Za-z0-9_-]{40,128})', array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'legacy_confirm_link' ), 'permission_callback' => '__return_true' ) );
		register_rest_route( 'persi/v1', '/newsletter/unsubscribe/(?P<token>[A-Za-z0-9_-]{40,128})', array( 'methods' => WP_REST_Server::READABLE, 'callback' => array( $this, 'legacy_unsubscribe_link' ), 'permission_callback' => '__return_true' ) );
	}
	public function legacy_confirm_link( WP_REST_Request $request ) { return $this->legacy_redirect( '/confirmar-newsletter', $request['token'] ); }
	public function legacy_unsubscribe_link( WP_REST_Request $request ) { return $this->legacy_redirect( '/cancelar-newsletter', $request['token'] ); }
	private function legacy_redirect( $path, $token ) { $response = $this->response( array( 'message' => 'Redirecionando.' ), 302 ); $response->header( 'Location', add_query_arg( 'token', $token, Persi_Headless_Newsletter_Configuration::frontend_url() . $path ) ); return $response; }

	private function response( $data, $status = 200, $retry = null ) {
		$response = new WP_REST_Response( $data, $status );
		foreach ( array( 'Cache-Control' => 'private, no-store, no-cache, max-age=0', 'Pragma' => 'no-cache', 'Referrer-Policy' => 'no-referrer', 'X-Content-Type-Options' => 'nosniff' ) as $name => $value ) $response->header( $name, $value );
		if ( $retry ) $response->header( 'Retry-After', (string) $retry );
		return $response;
	}
	private function neutral() { return $this->response( array( 'code' => 'accepted', 'message' => __( self::NEUTRAL_MESSAGE, 'persi-headless' ) ), 202 ); }
	private function authenticate( WP_REST_Request $request, $path ) {
		if ( strlen( $request->get_body() ) > 4096 || false === strpos( strtolower( (string) $request->get_header( 'content-type' ) ), 'application/json' ) ) return new WP_Error( 'invalid_request', 'Dados inválidos.', array( 'status' => 400 ) );
		return ( new Persi_Headless_Newsletter_Authenticator() )->authenticate( $request, '/wp-json/persi/v1' . $path );
	}

	public function subscribe( WP_REST_Request $request ) {
		global $wpdb;
		$auth = $this->authenticate( $request, '/newsletter/subscribe' );
		if ( is_wp_error( $auth ) ) return $this->response( array( 'message' => 'Não autorizado.' ), (int) ( $auth->get_error_data()['status'] ?? 401 ) );
		$data = ( new Persi_Headless_Newsletter_Validator() )->validate( $request->get_body(), $auth['origin'] );
		if ( ! $data ) return $this->neutral();
		$email_hash = hash_hmac( 'sha256', $data['email'], wp_salt( 'secure_auth' ) );
		if ( $this->rate_limited( 'subscribe', $email_hash, 3, 1800 ) || $this->rate_limited( 'subscribe_ip', $this->client_ip_hash(), 5, 600 ) ) return $this->neutral();
		$encrypted = Persi_Headless_Newsletter_Repository::encrypt_email( $data['email'] );
		if ( false === $encrypted ) return $this->response( array( 'code' => 'unavailable', 'message' => 'Serviço temporariamente indisponível.' ), 503 );
		$table = Persi_Headless_Newsletter_Repository::table();
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE email_hash=%s", $email_hash ) );
		$now = current_time( 'mysql', true );
		if ( $row && 'confirmed' === $row->status ) return $this->neutral();
		if ( $row && 'pending' === $row->status ) { $this->send_confirmation( $row, $data['email'] ); return $this->neutral(); }
		$confirmation = wp_generate_password( 48, false, false );
		$unsubscribe = wp_generate_password( 48, false, false );
		$consent_fields = array(
			'consent_given' => 1, 'consent_at' => $now, 'privacy_policy_version' => $data['policy_version'], 'privacy_policy_url' => $data['policy_url'],
			'consent_origin' => $auth['origin'], 'consent_ip_hash' => $this->client_ip_hash(), 'consent_user_agent_hash' => $this->user_agent_hash(),
		);
		if ( $row ) {
			$wpdb->update( $table, array_merge( $consent_fields, array(
				'email_encrypted' => $encrypted, 'status' => 'pending', 'confirmation_token' => hash( 'sha256', $confirmation ), 'unsubscribe_token' => hash( 'sha256', $unsubscribe ),
				'confirmed_at' => null, 'anonymized_at' => null, 'confirmation_attempts' => 0, 'last_confirmation_sent_at' => null,
				'expires_at' => gmdate( 'Y-m-d H:i:s', time() + $this->retention_days( 'pending' ) * DAY_IN_SECONDS ), 'updated_at' => $now,
			) ), array( 'id' => $row->id ) );
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id=%d", $row->id ) );
		} else {
			$wpdb->insert( $table, array_merge( $consent_fields, array(
				'email_hash' => $email_hash, 'email_encrypted' => $encrypted, 'status' => 'pending',
				'confirmation_token' => hash( 'sha256', $confirmation ), 'unsubscribe_token' => hash( 'sha256', $unsubscribe ), 'created_at' => $now,
				'expires_at' => gmdate( 'Y-m-d H:i:s', time() + $this->retention_days( 'pending' ) * DAY_IN_SECONDS ), 'updated_at' => $now,
			) ) );
			$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM {$table} WHERE id=%d", $wpdb->insert_id ) );
		}
		if ( $row ) $this->send_confirmation( $row, $data['email'], $confirmation );
		return $this->neutral();
	}

	public function resend_confirmation( WP_REST_Request $request ) {
		global $wpdb;
		$auth = $this->authenticate( $request, '/newsletter/resend-confirmation' );
		if ( is_wp_error( $auth ) ) return $this->response( array( 'message' => 'Não autorizado.' ), (int) ( $auth->get_error_data()['status'] ?? 401 ) );
		$body = json_decode( $request->get_body(), true );
		if ( ! is_array( $body ) || array_keys( $body ) !== array( 'email' ) ) return $this->neutral();
		$email = sanitize_email( $body['email'] ?? '' );
		$hash = hash_hmac( 'sha256', strtolower( $email ), wp_salt( 'secure_auth' ) );
		if ( $this->rate_limited( 'resend', $hash, 2, HOUR_IN_SECONDS ) ) return $this->neutral();
		$row = $wpdb->get_row( $wpdb->prepare( "SELECT * FROM " . Persi_Headless_Newsletter_Repository::table() . " WHERE email_hash=%s AND status='pending'", $hash ) );
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
		$url = add_query_arg( 'token', $token, Persi_Headless_Newsletter_Configuration::frontend_url() . '/confirmar-newsletter' );
		$sent = wp_mail( $email, __( 'Confirme sua inscrição na newsletter', 'persi-headless' ), sprintf( __( "Confirme sua inscrição na newsletter da Persi Materiais acessando:\n%s", 'persi-headless' ), esc_url_raw( $url ) ) );
		if ( ! $sent ) update_option( 'persi_headless_newsletter_last_failure', array( 'code' => 'mail_failed', 'at' => current_time( 'mysql', true ) ), false );
		$wpdb->update( Persi_Headless_Newsletter_Repository::table(), array(
			'confirmation_token' => hash( 'sha256', $token ), 'last_confirmation_sent_at' => current_time( 'mysql', true ),
			'confirmation_attempts' => (int) $row->confirmation_attempts + 1, 'failure_code' => $sent ? null : 'mail_failed', 'updated_at' => current_time( 'mysql', true ),
		), array( 'id' => $row->id, 'status' => 'pending' ) );
		return $sent;
	}

	public function confirm( WP_REST_Request $request ) {
		global $wpdb;
		$auth = $this->authenticate( $request, '/newsletter/confirm' );
		if ( is_wp_error( $auth ) ) return $this->response( array( 'message' => 'Não autorizado.' ), (int) ( $auth->get_error_data()['status'] ?? 401 ) );
		$body = json_decode( $request->get_body(), true ); $token = is_array( $body ) && array_keys( $body ) === array( 'token' ) ? (string) $body['token'] : '';
		if ( $this->rate_limited( 'confirm_token', hash( 'sha256', $token ), 20, 600 ) ) return $this->response( array( 'message' => 'Não foi possível concluir esta solicitação.' ), 429, 600 );
		$now = current_time( 'mysql', true );
		$updated = preg_match( '/^[A-Za-z0-9_-]{40,128}$/', $token ) ? $wpdb->query( $wpdb->prepare( "UPDATE " . Persi_Headless_Newsletter_Repository::table() . " SET status='confirmed',confirmed_at=%s,confirmation_token=NULL,expires_at=NULL,updated_at=%s WHERE confirmation_token=%s AND status='pending' AND expires_at>%s", $now, $now, hash( 'sha256', $token ), $now ) ) : 0;
		return $this->response( array( 'message' => $updated ? 'Sua inscrição foi confirmada.' : 'Não foi possível concluir esta solicitação.' ), $updated ? 200 : 400 );
	}

	public function unsubscribe( WP_REST_Request $request ) {
		global $wpdb;
		$auth = $this->authenticate( $request, '/newsletter/unsubscribe' );
		if ( is_wp_error( $auth ) ) return $this->response( array( 'message' => 'Não autorizado.' ), (int) ( $auth->get_error_data()['status'] ?? 401 ) );
		$body = json_decode( $request->get_body(), true ); $token = is_array( $body ) && array_keys( $body ) === array( 'token' ) ? (string) $body['token'] : '';
		if ( $this->rate_limited( 'unsubscribe_token', hash( 'sha256', $token ), 20, 600 ) ) return $this->response( array( 'message' => 'Não foi possível concluir esta solicitação.' ), 429, 600 );
		$now = current_time( 'mysql', true );
		$updated = preg_match( '/^[A-Za-z0-9_-]{40,128}$/', $token ) ? $wpdb->query( $wpdb->prepare( "UPDATE " . Persi_Headless_Newsletter_Repository::table() . " SET status='unsubscribed',unsubscribe_token='',expires_at=%s,updated_at=%s WHERE unsubscribe_token=%s AND status NOT IN ('unsubscribed','anonymized')", gmdate( 'Y-m-d H:i:s', time() + $this->retention_days( 'unsubscribed' ) * DAY_IN_SECONDS ), $now, hash( 'sha256', $token ) ) ) : 0;
		return $this->response( array( 'message' => $updated ? 'Sua inscrição foi cancelada.' : 'Não foi possível concluir esta solicitação.' ), $updated ? 200 : 400 );
	}

	private function rate_limited( $scope, $identity, $max, $ttl ) {
		$key = 'persi_newsletter_rate_' . substr( hash_hmac( 'sha256', $scope . '|' . $identity, Persi_Headless_Newsletter_Configuration::secret() ), 0, 40 );
		$count = absint( get_transient( $key ) ); set_transient( $key, $count + 1, $ttl ); return $count >= $max;
	}
	private function client_ip_hash() {
		$ip = (string) ( $_SERVER['REMOTE_ADDR'] ?? '' );
		$trust_proxy = defined( 'PERSI_HEADLESS_NEWSLETTER_TRUST_PROXY_HEADERS' ) && true === constant( 'PERSI_HEADLESS_NEWSLETTER_TRUST_PROXY_HEADERS' );
		$trusted_remote = in_array( $ip, Persi_Headless_Newsletter_Configuration::trusted_proxy_ips(), true );
		if ( $trust_proxy && $trusted_remote && ! empty( $_SERVER['HTTP_CF_CONNECTING_IP'] ) && filter_var( $_SERVER['HTTP_CF_CONNECTING_IP'], FILTER_VALIDATE_IP ) ) $ip = $_SERVER['HTTP_CF_CONNECTING_IP'];
		return '' === $ip ? null : hash_hmac( 'sha256', 'ip|' . $ip, Persi_Headless_Newsletter_Configuration::secret() );
	}
	private function user_agent_hash() { $ua = substr( (string) ( $_SERVER['HTTP_USER_AGENT'] ?? '' ), 0, 512 ); return '' === $ua ? null : hash_hmac( 'sha256', 'ua|' . $ua, Persi_Headless_Newsletter_Configuration::secret() ); }
	private function retention_days( $status ) { $defaults = array( 'pending' => 7, 'unsubscribed' => 30 ); return $defaults[ $status ] ?? 30; }
	private function ensure_cleanup() {
		if ( function_exists( 'as_schedule_recurring_action' ) && ! as_has_scheduled_action( self::CLEANUP_ACTION, array(), self::GROUP ) ) as_schedule_recurring_action( time() + HOUR_IN_SECONDS, DAY_IN_SECONDS, self::CLEANUP_ACTION, array(), self::GROUP, true );
		elseif ( ! wp_next_scheduled( self::CLEANUP_ACTION ) ) wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::CLEANUP_ACTION );
	}
	public function cleanup() { Persi_Headless_Newsletter_Repository::anonymize_expired(); Persi_Headless_Newsletter_Repository::cleanup_nonces(); }
}
