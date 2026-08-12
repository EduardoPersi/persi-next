<?php
defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Contact {
	const NEUTRAL_MESSAGE = 'Não foi possível enviar sua mensagem. Tente novamente.';
	const SUBJECTS = array( 'duvidas' => 'Dúvidas', 'devolucoes' => 'Devoluções', 'trocas' => 'Trocas', 'outros' => 'Outros' );

	public function register() {
		foreach ( array( 'class-configuration.php', 'class-authenticator.php' ) as $file ) require_once __DIR__ . '/' . $file;
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes() {
		register_rest_route( 'persi/v1', '/contact/submit', array( 'methods' => WP_REST_Server::CREATABLE, 'callback' => array( $this, 'submit' ), 'permission_callback' => '__return_true' ) );
	}

	private function response( $data, $status = 200, $retry = null ) {
		$response = new WP_REST_Response( $data, $status );
		foreach ( array( 'Cache-Control' => 'private, no-store, no-cache, max-age=0', 'Pragma' => 'no-cache', 'Referrer-Policy' => 'no-referrer', 'X-Content-Type-Options' => 'nosniff' ) as $name => $value ) $response->header( $name, $value );
		if ( $retry ) $response->header( 'Retry-After', (string) $retry );
		return $response;
	}
	private function neutral( $status = 400 ) { return $this->response( array( 'code' => 'validation_error', 'message' => __( self::NEUTRAL_MESSAGE, 'persi-headless' ) ), $status ); }
	private function authenticate( WP_REST_Request $request, $path ) {
		if ( strlen( $request->get_body() ) > 8192 || false === strpos( strtolower( (string) $request->get_header( 'content-type' ) ), 'application/json' ) ) return new WP_Error( 'invalid_request', 'Dados inválidos.', array( 'status' => 400 ) );
		return ( new Persi_Headless_Contact_Authenticator() )->authenticate( $request, '/wp-json/persi/v1' . $path );
	}

	private function validate( $raw_body ) {
		$body = json_decode( $raw_body, true );
		if ( ! is_array( $body ) || array_diff( array_keys( $body ), array( 'name', 'email', 'subject', 'message' ) ) || array_diff( array( 'name', 'email', 'subject', 'message' ), array_keys( $body ) ) ) return null;
		$name = trim( sanitize_text_field( (string) $body['name'] ) );
		$email = sanitize_email( (string) $body['email'] );
		$subject = (string) $body['subject'];
		$message = trim( sanitize_textarea_field( (string) $body['message'] ) );
		if ( '' === $name || strlen( $name ) > 120 || ! is_email( $email ) || ! array_key_exists( $subject, self::SUBJECTS ) || '' === $message || strlen( $message ) > 4000 ) return null;
		return array( 'name' => $name, 'email' => $email, 'subject' => $subject, 'message' => $message );
	}

	public function submit( WP_REST_Request $request ) {
		$auth = $this->authenticate( $request, '/contact/submit' );
		if ( is_wp_error( $auth ) ) return $this->response( array( 'message' => 'Não autorizado.' ), (int) ( $auth->get_error_data()['status'] ?? 401 ) );
		$data = $this->validate( $request->get_body() );
		if ( ! $data ) return $this->neutral();
		$email_hash = hash_hmac( 'sha256', $data['email'], wp_salt( 'secure_auth' ) );
		if ( $this->rate_limited( 'submit', $email_hash, 3, 1800 ) || $this->rate_limited( 'submit_ip', $this->client_ip_hash(), 5, 600 ) ) return $this->response( array( 'message' => 'Não foi possível concluir esta solicitação.' ), 429, 600 );
		$sent = $this->send( $data );
		if ( ! $sent ) {
			update_option( 'persi_headless_contact_last_failure', array( 'code' => 'mail_failed', 'at' => current_time( 'mysql', true ) ), false );
			return $this->response( array( 'code' => 'submission_error', 'message' => __( self::NEUTRAL_MESSAGE, 'persi-headless' ) ), 502 );
		}
		return $this->response( array( 'code' => 'success', 'message' => 'Mensagem enviada.' ) );
	}

	private function send( $data ) {
		$subject_label = self::SUBJECTS[ $data['subject'] ];
		$subject = sprintf( __( '[Contato do site] %s — %s', 'persi-headless' ), $subject_label, $data['name'] );
		$body = sprintf(
			__( "Nova mensagem recebida pelo formulário de contato do site.\n\nNome: %1\$s\nE-mail: %2\$s\nAssunto: %3\$s\n\nMensagem:\n%4\$s", 'persi-headless' ),
			$data['name'],
			$data['email'],
			$subject_label,
			$data['message']
		);
		$headers = array( 'Reply-To: ' . $data['name'] . ' <' . $data['email'] . '>' );
		return wp_mail( Persi_Headless_Contact_Configuration::recipient(), $subject, $body, $headers );
	}

	private function rate_limited( $scope, $identity, $max, $ttl ) {
		$key = 'persi_contact_rate_' . substr( hash_hmac( 'sha256', $scope . '|' . $identity, Persi_Headless_Contact_Configuration::secret() ), 0, 40 );
		$count = absint( get_transient( $key ) ); set_transient( $key, $count + 1, $ttl ); return $count >= $max;
	}
	private function client_ip_hash() {
		$ip = (string) ( $_SERVER['REMOTE_ADDR'] ?? '' );
		$trust_proxy = defined( 'PERSI_HEADLESS_CONTACT_TRUST_PROXY_HEADERS' ) && true === constant( 'PERSI_HEADLESS_CONTACT_TRUST_PROXY_HEADERS' );
		$trusted_remote = in_array( $ip, Persi_Headless_Contact_Configuration::trusted_proxy_ips(), true );
		if ( $trust_proxy && $trusted_remote && ! empty( $_SERVER['HTTP_CF_CONNECTING_IP'] ) && filter_var( $_SERVER['HTTP_CF_CONNECTING_IP'], FILTER_VALIDATE_IP ) ) $ip = $_SERVER['HTTP_CF_CONNECTING_IP'];
		return '' === $ip ? null : hash_hmac( 'sha256', 'ip|' . $ip, Persi_Headless_Contact_Configuration::secret() );
	}
}
