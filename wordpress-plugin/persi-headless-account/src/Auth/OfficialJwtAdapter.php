<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

/** Integra usuários sociais já verificados ao emissor do plugin JWT oficial. */
final class OfficialJwtAdapter {
	private const TOKEN_ROUTE = '/jwt-auth/v1/token';

	public function issue_for_user( \WP_User $user ): array {
		// Credenciais efêmeras servem somente para identificar esta chamada interna.
		// Elas nunca são comparadas à senha real, gravadas ou aplicadas ao usuário.
		$username = 'persi-social-' . wp_generate_uuid4();
		$password = wp_generate_password( 64, true, true );
		$authenticate = static function ( $authenticated, string $candidate_username, string $candidate_password ) use ( $user, $username, $password ) {
			if ( hash_equals( $username, $candidate_username ) && hash_equals( $password, $candidate_password ) ) return $user;
			return $authenticated;
		};

		// Prioridade 1 entrega o WP_User já verificado antes dos autenticadores padrão.
		add_filter( 'authenticate', $authenticate, 1, 3 );
		try {
			$request = new \WP_REST_Request( 'POST', self::TOKEN_ROUTE );
			$request->set_param( 'username', $username );
			$request->set_param( 'password', $password );
			$response = rest_do_request( $request );
		} finally {
			// O filtro existe apenas durante rest_do_request, inclusive quando há erro.
			remove_filter( 'authenticate', $authenticate, 1 );
		}

		if ( $response->is_error() ) throw new \RuntimeException( 'O endpoint JWT oficial recusou a emissão.' );
		$data = $response->get_data();
		if ( ! is_array( $data ) || ! is_string( $data['token'] ?? null ) || 1 !== preg_match( '/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/', $data['token'] ) ) {
			throw new \RuntimeException( 'O endpoint JWT oficial retornou uma resposta inválida.' );
		}
		if ( ! is_string( $data['user_email'] ?? null ) || ! hash_equals( strtolower( $user->user_email ), strtolower( $data['user_email'] ) ) ) {
			throw new \RuntimeException( 'O endpoint JWT oficial retornou outro usuário.' );
		}
		return $data;
	}
}
