<?php
namespace Persi\HeadlessAccount\Api;

use Persi\HeadlessAccount\Security\AuthenticationException;
use Persi\HeadlessAccount\Security\ClientFingerprint;
use Persi\HeadlessAccount\Security\RateLimiter;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\Response;
use Persi\HeadlessAccount\Validation\AccountAccessPayloadValidator;
use Persi\HeadlessAccount\Validation\ValidationException;

defined( 'ABSPATH' ) || exit;

final class AccountAccessController {
	private const NAMESPACE = 'persi-account/v1';
	private const BASE_PATH = '/wp-json/persi-account/v1';
	private const GENERIC_RECOVERY = 'Se existir uma conta com este e-mail, enviaremos as instruções.';

	public function __construct(
		private readonly RequestAuthenticator $authenticator,
		private readonly RateLimiter $limiter,
		private readonly ClientFingerprint $fingerprint,
		private readonly Configuration $configuration,
		private readonly AccountAccessPayloadValidator $validator
	) {}

	public function register_routes(): void {
		foreach ( array( '/register' => 'register', '/forgot-password' => 'forgot_password', '/reset-password' => 'reset_password' ) as $route => $callback ) {
			register_rest_route( self::NAMESPACE, $route, array( 'methods' => \WP_REST_Server::CREATABLE, 'callback' => array( $this, $callback ), 'permission_callback' => '__return_true' ) );
		}
	}

	public function register( \WP_REST_Request $request ): \WP_REST_Response {
		$auth = $this->authenticate( $request, '/register' );
		if ( $auth ) return $auth;
		try { $input = $this->validator->register( $request->get_body() ); } catch ( ValidationException $error ) { return Response::json( array( 'message' => 'Confira os dados informados.' ), 400 ); }
		$buckets = $this->buckets( 'register', $input['email'] );
		$retry = $this->limiter->retry_after( $buckets );
		if ( $retry > 0 ) return Response::json( array( 'message' => 'Muitas tentativas.' ), 429, $retry );
		foreach ( $buckets as $bucket ) $this->limiter->record_failure( $bucket );
		if ( email_exists( $input['email'] ) ) return Response::json( array( 'message' => 'Não foi possível criar a conta com os dados informados.' ), 409 );
		$parts = preg_split( '/\s+/', $input['name'], 2 );
		$username = $this->username( $input['email'] );
		$user_id = wp_insert_user( array(
			'user_login' => $username, 'user_email' => $input['email'], 'user_pass' => $input['password'],
			'display_name' => $input['name'], 'first_name' => $parts[0], 'last_name' => $parts[1] ?? '', 'role' => 'customer',
		) );
		if ( is_wp_error( $user_id ) ) return Response::json( array( 'message' => 'Não foi possível criar a conta agora.' ), 503 );
		if ( '' !== $input['phone'] ) update_user_meta( $user_id, 'billing_phone', $input['phone'] );
		$cpf_key = apply_filters( 'persi_headless_account_cpf_meta_key', '' );
		if ( '' !== $input['cpf'] && is_string( $cpf_key ) && '' !== $cpf_key ) update_user_meta( $user_id, $cpf_key, $input['cpf'] );
		return Response::json( array( 'registered' => true ), 201 );
	}

	public function forgot_password( \WP_REST_Request $request ): \WP_REST_Response {
		$auth = $this->authenticate( $request, '/forgot-password' );
		if ( $auth ) return $auth;
		try { $email = $this->validator->forgot( $request->get_body() ); } catch ( ValidationException $error ) { return Response::json( array( 'message' => self::GENERIC_RECOVERY ) ); }
		$buckets = $this->buckets( 'forgot', $email );
		$retry = $this->limiter->retry_after( $buckets );
		if ( 0 === $retry ) {
			foreach ( $buckets as $bucket ) $this->limiter->record_failure( $bucket );
			add_filter( 'retrieve_password_message', array( $this, 'recovery_email' ), 10, 4 );
			retrieve_password( $email );
			remove_filter( 'retrieve_password_message', array( $this, 'recovery_email' ), 10 );
		}
		return Response::json( array( 'message' => self::GENERIC_RECOVERY ) );
	}

	public function recovery_email( string $message, string $key, string $login, $user ): string {
		$origins = $this->configuration->allowed_origins();
		if ( empty( $origins ) ) return $message;
		$url = add_query_arg(
			array( 'key' => $key, 'login' => $login ),
			$origins[0] . '/redefinir-senha'
		);
		return "Recebemos uma solicitação para redefinir sua senha na Persi Materiais.\n\n" .
			"Use o link abaixo:\n" . esc_url_raw( $url ) . "\n\n" .
			"Se você não fez esta solicitação, ignore este e-mail.";
	}

	public function reset_password( \WP_REST_Request $request ): \WP_REST_Response {
		$auth = $this->authenticate( $request, '/reset-password' );
		if ( $auth ) return $auth;
		try { $input = $this->validator->reset( $request->get_body() ); } catch ( ValidationException $error ) { return Response::json( array( 'message' => 'Link ou dados inválidos.' ), 400 ); }
		$buckets = $this->buckets( 'reset', $input['login'] );
		$retry = $this->limiter->retry_after( $buckets );
		if ( $retry > 0 ) return Response::json( array( 'message' => 'Muitas tentativas.' ), 429, $retry );
		foreach ( $buckets as $bucket ) $this->limiter->record_failure( $bucket );
		$user = check_password_reset_key( $input['key'], $input['login'] );
		if ( is_wp_error( $user ) || ! $user instanceof \WP_User ) return Response::json( array( 'message' => 'Link ou dados inválidos.' ), 400 );
		reset_password( $user, $input['password'] );
		return Response::json( array( 'reset' => true ) );
	}

	private function authenticate( \WP_REST_Request $request, string $route ): ?\WP_REST_Response {
		$body = $request->get_body();
		if ( strlen( $body ) > Configuration::BODY_LIMIT_BYTES || 1 !== preg_match( '/^application\/json(?:\s*;|$)/', strtolower( trim( (string) $request->get_header( 'content-type' ) ) ) ) ) return Response::json( array( 'message' => 'Dados inválidos.' ), 400 );
		try {
			$headers = array();
			foreach ( array( 'x-persi-key-id', 'x-persi-timestamp', 'x-persi-nonce', 'x-persi-origin', 'x-persi-signature' ) as $name ) $headers[ $name ] = (string) $request->get_header( $name );
			$this->authenticator->authenticate( 'POST', self::BASE_PATH . $route, $headers, $body );
			return null;
		} catch ( AuthenticationException $error ) {
			return Response::json( array( 'message' => 'Requisição não autorizada.' ), 'service_unavailable' === $error->error_code() ? 503 : 401 );
		}
	}

	private function buckets( string $scope, string $email ): array {
		$ip = $this->fingerprint->ip_hash( $_SERVER );
		return array_filter( array(
			$ip ? hash_hmac( 'sha256', $scope . '|ip|' . $ip, $this->configuration->secret() ) : null,
			hash_hmac( 'sha256', $scope . '|email|' . strtolower( $email ), $this->configuration->secret() ),
		) );
	}

	private function username( string $email ): string {
		$base = sanitize_user( strstr( $email, '@', true ), true ) ?: 'cliente';
		$username = $base; $suffix = 1;
		while ( username_exists( $username ) ) $username = $base . $suffix++;
		return $username;
	}
}
