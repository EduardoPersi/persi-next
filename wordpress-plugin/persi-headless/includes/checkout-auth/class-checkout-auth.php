<?php

defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Checkout_Auth {
	private const NAMESPACE = 'persi-headless/v1';
	private const CODE_HASH_META = '_persi_checkout_login_code_hash';
	private const CODE_EXPIRES_META = '_persi_checkout_login_code_expires';
	private const CODE_ATTEMPTS_META = '_persi_checkout_login_code_attempts';
	private const CODE_MAX_ATTEMPTS = 5;
	private const CODE_COOLDOWN_SECONDS = 60;
	private $authenticator;
	private $limiter;
	private $jwt;

	public function __construct() {
		$this->authenticator = new Persi_Headless_Checkout_Auth_Authenticator();
		$this->limiter = new Persi_Headless_Checkout_Auth_Rate_Limiter();
		$this->jwt = new Persi_Headless_Checkout_Auth_Jwt_Adapter();
	}

	public function register() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes() {
		$routes = array(
			'/checkout-auth/identify'     => 'identify',
			'/checkout-auth/password'     => 'password',
			'/checkout-auth/code/request' => 'request_code',
			'/checkout-auth/code/verify'  => 'verify_code',
		);
		foreach ( $routes as $route => $callback ) {
			register_rest_route( self::NAMESPACE, $route, array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, $callback ),
				'permission_callback' => array( $this->authenticator, 'authorize' ),
			) );
		}
	}

	public function identify( WP_REST_Request $request ) {
		$email = $this->email_payload( $request, array( 'email' ) );
		if ( $email instanceof WP_REST_Response ) return $email;
		$retry = $this->limited( $request, 'identify', $email, 20, 900 );
		if ( $retry ) return $this->rate_response( $retry );
		return $this->response( array( 'exists' => get_user_by( 'email', $email ) instanceof WP_User ) );
	}

	public function password( WP_REST_Request $request ) {
		$payload = $this->payload( $request, array( 'email', 'password' ) );
		if ( $payload instanceof WP_REST_Response ) return $payload;
		$email = sanitize_email( strtolower( trim( (string) $payload['email'] ) ) );
		$password = is_string( $payload['password'] ?? null ) ? $payload['password'] : '';
		if ( ! is_email( $email ) || '' === $password || strlen( $password ) > 4096 ) return $this->error( 'Dados inválidos.', 400 );
		$retry = $this->limited( $request, 'password', $email, 5, 900 );
		if ( $retry ) return $this->rate_response( $retry );
		$expected_user = $this->customer_by_email( $email );
		if ( ! $expected_user ) return $this->error( 'Não foi possível acessar esta conta no checkout.', 401, 'CHECKOUT_ACCOUNT_REJECTED' );
		$user = wp_signon( array( 'user_login' => $email, 'user_password' => $password, 'remember' => false ), is_ssl() );
		if ( is_wp_error( $user ) || ! $user instanceof WP_User || (int) $user->ID !== (int) $expected_user->ID ) {
			return $this->error( 'Senha incorreta. Confira e tente novamente.', 401, 'CHECKOUT_PASSWORD_REJECTED' );
		}
		return $this->authenticated( $user );
	}

	public function request_code( WP_REST_Request $request ) {
		$email = $this->email_payload( $request, array( 'email' ) );
		if ( $email instanceof WP_REST_Response ) return $email;
		$user = $this->customer_by_email( $email );
		if ( ! $user ) return $this->error( 'Não foi possível enviar o código.', 404 );

		$cooldown_key = 'persi_checkout_auth_cooldown_' . hash_hmac( 'sha256', $email, wp_salt( 'nonce' ) );
		$cooldown_until = (int) get_transient( $cooldown_key );
		if ( $cooldown_until > time() ) return $this->rate_response( $cooldown_until - time() );
		$retry = $this->limited( $request, 'code_request', $email, 5, HOUR_IN_SECONDS );
		if ( $retry ) return $this->rate_response( $retry );

		$code = (string) random_int( 100000, 999999 );
		$ttl = $this->code_ttl_minutes();
		update_user_meta( $user->ID, self::CODE_HASH_META, wp_hash_password( $code ) );
		update_user_meta( $user->ID, self::CODE_EXPIRES_META, time() + $ttl * MINUTE_IN_SECONDS );
		update_user_meta( $user->ID, self::CODE_ATTEMPTS_META, 0 );

		$subject = sprintf( '[Persi] Seu código de acesso é %s', $code );
		$name = trim( (string) $user->first_name ) ?: 'cliente';
		$message = sprintf(
			"Olá, %s.\n\nSeu código para continuar sua compra é:\n\n%s\n\nEle expira em %d minutos.\n\nSe você não solicitou este código, ignore esta mensagem.",
			$name,
			$code,
			$ttl
		);
		if ( ! wp_mail( $user->user_email, $subject, $message ) ) {
			$this->clear_code( $user->ID );
			return $this->error( 'Não foi possível enviar o código agora.', 503 );
		}

		$cooldown_until = time() + self::CODE_COOLDOWN_SECONDS;
		set_transient( $cooldown_key, $cooldown_until, self::CODE_COOLDOWN_SECONDS );
		return $this->response( array(
			'sent' => true,
			'cooldown' => self::CODE_COOLDOWN_SECONDS,
			'expires_in' => $ttl * MINUTE_IN_SECONDS,
		) );
	}

	public function verify_code( WP_REST_Request $request ) {
		$payload = $this->payload( $request, array( 'code', 'email' ) );
		if ( $payload instanceof WP_REST_Response ) return $payload;
		$email = sanitize_email( strtolower( trim( (string) $payload['email'] ) ) );
		$code = is_string( $payload['code'] ?? null ) ? $payload['code'] : '';
		if ( ! is_email( $email ) || 1 !== preg_match( '/^\d{6}$/', $code ) ) return $this->error( 'Código inválido.', 400 );
		$retry = $this->limited( $request, 'code_verify', $email, 10, 900 );
		if ( $retry ) return $this->rate_response( $retry );
		$user = $this->customer_by_email( $email );
		if ( ! $user ) return $this->error( 'Código inválido ou expirado.', 401 );

		$hash = (string) get_user_meta( $user->ID, self::CODE_HASH_META, true );
		$expires = (int) get_user_meta( $user->ID, self::CODE_EXPIRES_META, true );
		$attempts = (int) get_user_meta( $user->ID, self::CODE_ATTEMPTS_META, true );
		if ( '' === $hash || $expires < time() || $attempts >= self::CODE_MAX_ATTEMPTS ) {
			$this->clear_code( $user->ID );
			return $this->error( 'Código inválido ou expirado. Solicite um novo.', 401, 'CHECKOUT_CODE_EXPIRED' );
		}
		if ( ! wp_check_password( $code, $hash ) ) {
			++$attempts;
			if ( $attempts >= self::CODE_MAX_ATTEMPTS ) {
				$this->clear_code( $user->ID );
				return $this->error( 'Limite de tentativas atingido. Solicite um novo código.', 429, 'CHECKOUT_CODE_ATTEMPTS_EXHAUSTED' );
			}
			update_user_meta( $user->ID, self::CODE_ATTEMPTS_META, $attempts );
			return $this->error( 'Código incorreto. Confira e tente novamente.', 401, 'CHECKOUT_CODE_REJECTED' );
		}

		$this->clear_code( $user->ID );
		return $this->authenticated( $user );
	}

	private function authenticated( WP_User $user ) {
		wp_set_current_user( $user->ID );
		wp_set_auth_cookie( $user->ID, false, is_ssl() );
		try {
			$token = $this->jwt->issue( $user );
			return $this->response( array( 'token' => $token['token'], 'expires_at' => $token['expires_at'] ) );
		} catch ( Throwable $error ) {
			return $this->error( 'Não foi possível iniciar sua sessão.', 503 );
		}
	}

	private function customer_by_email( string $email ) {
		$user = get_user_by( 'email', $email );
		return $user instanceof WP_User && $this->allowed_user( $user ) ? $user : null;
	}

	private function allowed_user( WP_User $user ): bool {
		return 0 === (int) $user->user_status && ! empty( array_intersect( array( 'customer', 'subscriber' ), (array) $user->roles ) );
	}

	private function code_ttl_minutes(): int {
		$value = defined( 'PERSI_CHECKOUT_LOGIN_CODE_TTL_MINUTES' ) ? (int) constant( 'PERSI_CHECKOUT_LOGIN_CODE_TTL_MINUTES' ) : 10;
		return min( 15, max( 5, $value ) );
	}

	private function clear_code( int $user_id ): void {
		delete_user_meta( $user_id, self::CODE_HASH_META );
		delete_user_meta( $user_id, self::CODE_EXPIRES_META );
		delete_user_meta( $user_id, self::CODE_ATTEMPTS_META );
	}

	private function email_payload( WP_REST_Request $request, array $keys ) {
		$payload = $this->payload( $request, $keys );
		if ( $payload instanceof WP_REST_Response ) return $payload;
		$email = sanitize_email( strtolower( trim( (string) ( $payload['email'] ?? '' ) ) ) );
		return is_email( $email ) ? $email : $this->error( 'Informe um e-mail válido.', 400 );
	}

	private function payload( WP_REST_Request $request, array $keys ) {
		if ( strlen( $request->get_body() ) > 8192 || 1 !== preg_match( '/^application\/json(?:\s*;|$)/i', trim( (string) $request->get_header( 'content-type' ) ) ) ) {
			return $this->error( 'Dados inválidos.', 400 );
		}
		$payload = json_decode( $request->get_body(), true );
		if ( ! is_array( $payload ) || array_values( array_unique( array_keys( $payload ) ) ) !== array_keys( $payload ) ) return $this->error( 'Dados inválidos.', 400 );
		$actual = array_keys( $payload ); sort( $actual ); $expected = $keys; sort( $expected );
		return $actual === $expected ? $payload : $this->error( 'Dados inválidos.', 400 );
	}

	private function limited( WP_REST_Request $request, string $scope, string $email, int $limit, int $window ): int {
		$email_retry = $this->limiter->consume( $scope . ':email', $email, $limit, $window );
		$client = (string) $request->get_header( 'x-persi-client-fingerprint' );
		$fingerprint = 1 === preg_match( '/^[a-f0-9]{64}$/', $client ) ? $client : $this->limiter->fingerprint( $request );
		$client_retry = $this->limiter->consume( $scope . ':client', $fingerprint, $limit * 3, $window );
		return max( $email_retry, $client_retry );
	}

	private function rate_response( int $retry ) {
		$response = $this->error( 'Muitas tentativas. Aguarde para tentar novamente.', 429, 'CHECKOUT_AUTH_RATE_LIMITED' );
		$response->header( 'Retry-After', (string) $retry );
		$response->set_data( array_merge( $response->get_data(), array( 'retry_after' => $retry ) ) );
		return $response;
	}

	private function error( string $message, int $status, string $code = 'CHECKOUT_AUTH_ERROR' ) {
		return $this->response( array( 'message' => $message, 'code' => $code ), $status );
	}

	private function response( array $data, int $status = 200 ) {
		$response = new WP_REST_Response( $data, $status );
		$response->header( 'Cache-Control', 'private, no-store, max-age=0' );
		$response->header( 'Pragma', 'no-cache' );
		$response->header( 'X-Content-Type-Options', 'nosniff' );
		return $response;
	}
}
