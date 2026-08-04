<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

/**
 * Resolve o usuário do Bearer diretamente do token já validado pelo plugin
 * JWT oficial, em vez de confiar em wp_get_current_user(). Em produção,
 * wp_get_current_user() chegou a devolver outro usuário para o mesmo
 * token (cache de objeto Redis ativo) — a identidade não pode depender
 * de estado ambiente compartilhado entre requisições.
 */
final class BearerAuthorization {
	private const VALIDATE_ROUTE = '/jwt-auth/v1/token/validate';

	public function user( \WP_REST_Request $request ) {
		$authorization = trim( (string) $request->get_header( 'authorization' ) );
		if ( 1 !== preg_match( '/^Bearer\s+([A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+)$/', $authorization, $matches ) ) {
			return new \WP_Error( 'persi_jwt_missing', 'Autenticação necessária.', array( 'status' => 401 ) );
		}

		$validation_request = new \WP_REST_Request( 'POST', self::VALIDATE_ROUTE );
		$validation_request->set_header( 'authorization', 'Bearer ' . $matches[1] );
		$validation_response = rest_do_request( $validation_request );
		if ( $validation_response->is_error() ) {
			return new \WP_Error( 'persi_jwt_invalid', 'JWT inválido ou expirado.', array( 'status' => 401 ) );
		}

		$user_id = self::user_id_from_payload( $matches[2] );
		if ( $user_id <= 0 ) {
			return new \WP_Error( 'persi_jwt_invalid', 'JWT inválido ou expirado.', array( 'status' => 401 ) );
		}

		$user = get_user_by( 'id', $user_id );
		if ( ! $user instanceof \WP_User || ! CredentialsAuthenticator::is_allowed_user( $user ) ) {
			return new \WP_Error( 'persi_jwt_invalid', 'JWT inválido ou expirado.', array( 'status' => 401 ) );
		}

		return $user;
	}

	/**
	 * Lê o ID do usuário do payload do JWT (já validado acima pelo plugin
	 * oficial). Isto não substitui a verificação de assinatura/expiração —
	 * apenas lê um claim de um token cuja validade já foi confirmada.
	 */
	private static function user_id_from_payload( string $payload_segment ): int {
		$padded = strtr( $payload_segment, '-_', '+/' );
		$padded .= str_repeat( '=', ( 4 - strlen( $padded ) % 4 ) % 4 );
		$decoded = base64_decode( $padded, true );
		if ( ! is_string( $decoded ) ) return 0;
		$payload = json_decode( $decoded, true );
		if ( ! is_array( $payload ) ) return 0;
		return (int) ( $payload['data']['user']['id'] ?? 0 );
	}
}
