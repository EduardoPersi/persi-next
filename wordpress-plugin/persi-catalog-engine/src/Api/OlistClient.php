<?php
namespace Persi\CatalogEngine\Api;
use Persi\CatalogEngine\Infrastructure\OlistSnapshotRepository;
use Persi\CatalogEngine\Support\Performance;
defined( 'ABSPATH' ) || exit;
class OlistClient {
	private Configuration $configuration; private TokenStore $tokens;
	public function __construct( ?Configuration $configuration = null, ?TokenStore $tokens = null ) { $this->configuration = $configuration ?? new Configuration(); $this->tokens = $tokens ?? new TokenStore(); }
	public function find_by_sku( string $sku ) {
		$url = add_query_arg( array( 'codigo' => $sku, 'limit' => 100, 'offset' => 0 ), Configuration::API_BASE . '/produtos' ); $body = $this->get_json( $url, 'SKU_LOOKUP' );
		if ( is_wp_error( $body ) ) { return 'olist_not_found' === $body->get_error_code() ? array() : $body; }
		if ( ! isset( $body['itens'] ) || ! is_array( $body['itens'] ) ) { return $this->error( 'olist_invalid_response', 'OLIST_UNEXPECTED_RESPONSE', 'Resposta Olist sem a lista esperada de produtos.', 'SKU_LOOKUP', 200, 1, 'PRODUCT_SEARCH' ); }
		return array_values( array_filter( $body['itens'], static fn( $item ): bool => is_array( $item ) && isset( $item['id'] ) && array_key_exists( 'sku', $item ) ) );
	}
	public function product_detail( int $olist_product_id ) {
		if ( $olist_product_id < 1 ) { return $this->error( 'olist_invalid_product_id', 'OLIST_PRODUCT_DETAIL_FAILED', 'ID Olist inválido.', 'PRODUCT_DETAIL', 0, 1, 'PRODUCT_DETAIL' ); }
		$cache = new OlistSnapshotRepository(); $cached = $cache->by_id( $olist_product_id ); if ( $cached && ! empty( $cached['_persi_detail'] ) ) { unset( $cached['_persi_detail'] ); return $cached; }
		$detail = $this->get_json( Configuration::API_BASE . '/produtos/' . $olist_product_id, 'PRODUCT_DETAIL' );
		if ( ! is_wp_error( $detail ) ) { $sku = (string) ( $detail['sku'] ?? $detail['codigo'] ?? $cached['sku'] ?? '' ); $stored = array_merge( is_array( $cached ) ? $cached : array(), $detail ); $stored['_persi_detail'] = true; $cache->save( $sku, $olist_product_id, $stored ); }
		return $detail;
	}
	private function get_json( string $url, string $stage ) {
		$token = $this->access_token(); if ( is_wp_error( $token ) ) { return $token; }
		$endpoint = 'PRODUCT_DETAIL' === $stage ? 'PRODUCT_DETAIL' : 'PRODUCT_SEARCH'; $response = null; $attempt = 0;
		for ( $attempt = 1; $attempt <= 3; ++$attempt ) {
			$started = Performance::start(); $response = wp_safe_remote_get( $url, array( 'timeout' => 15, 'redirection' => 0, 'headers' => array( 'Authorization' => 'Bearer ' . $token, 'Accept' => 'application/json' ) ) ); Performance::record( 'PRODUCT_DETAIL' === $stage ? 'OLIST_DETAIL' : 'OLIST_HTTP_SEARCH', Performance::elapsed_ms( $started ) );
			if ( is_wp_error( $response ) ) { if ( $attempt < 3 ) { $this->backoff( $attempt ); continue; } $message = strtolower( $response->get_error_message() ); $technical = false !== strpos( $message, 'timed out' ) || false !== strpos( $message, 'timeout' ) ? 'OLIST_TIMEOUT' : 'OLIST_CONNECTION_ERROR'; return $this->error( 'olist_transport_error', $technical, 'Falha de comunicação com o Olist.', $stage, 0, $attempt, $endpoint ); }
			$status = (int) wp_remote_retrieve_response_code( $response );
			if ( 401 === $status && 1 === $attempt ) { $this->tokens->expire_access(); $refreshed = $this->access_token( true ); if ( is_wp_error( $refreshed ) ) { return $refreshed; } $token = $refreshed; continue; }
			if ( 429 === $status || in_array( $status, array( 500, 502, 503, 504 ), true ) ) { if ( $attempt < 3 ) { $this->backoff( $attempt ); continue; } $retry = $this->retry_after( $response ); return $this->error( 429 === $status ? 'olist_rate_limited' : 'olist_api_error', 429 === $status ? 'OLIST_HTTP_429' : 'OLIST_HTTP_5XX', 429 === $status ? 'Limite temporário da API atingido.' : 'Olist temporariamente indisponível.', $stage, $status, $attempt, $endpoint, $retry ); }
			break;
		}
		$status = (int) wp_remote_retrieve_response_code( $response );
		if ( 401 === $status ) { return $this->error( 'olist_unauthorized', 'OLIST_HTTP_401', 'Autorização Olist recusada após renovação controlada.', $stage, 401, $attempt, $endpoint ); }
		if ( 403 === $status ) { return $this->error( 'olist_forbidden', 'OLIST_HTTP_403', 'Aplicativo sem permissão de leitura de produtos.', $stage, 403, $attempt, $endpoint ); }
		if ( 404 === $status ) { return $this->error( 'olist_not_found', 'OLIST_HTTP_404', 'Registro não encontrado no Olist.', $stage, 404, $attempt, $endpoint ); }
		if ( $status < 200 || $status >= 300 ) { $technical = in_array( $status, array( 400, 409, 422 ), true ) ? 'OLIST_HTTP_' . $status : 'OLIST_HTTP_ERROR'; return $this->error( 'olist_api_error', $technical, 'Olist recusou a consulta.', $stage, $status, $attempt, $endpoint ); }
		$body = json_decode( wp_remote_retrieve_body( $response ), true ); if ( ! is_array( $body ) ) { return $this->error( 'olist_invalid_response', 'OLIST_INVALID_JSON', 'Resposta Olist não contém JSON válido.', $stage, $status, $attempt, $endpoint ); } return $body;
	}
	private function access_token( bool $force_refresh = false ) {
		$tokens = $this->tokens->get(); if ( ! $force_refresh && ! empty( $tokens['access_token'] ) && absint( $tokens['expires_at'] ?? 0 ) > time() ) { return $tokens['access_token']; }
		if ( empty( $tokens['refresh_token'] ) || ! $this->configuration->configured() ) { return $this->error( 'olist_not_connected', 'OLIST_TOKEN_REFRESH_FAILED', 'Conta Olist sem refresh token ou credenciais configuradas.', 'TOKEN_REFRESH', 0, 1, 'TOKEN' ); }
		$response = wp_safe_remote_post( Configuration::TOKEN_URL, array( 'timeout' => 20, 'body' => array( 'grant_type' => 'refresh_token', 'client_id' => $this->configuration->client_id(), 'client_secret' => $this->configuration->client_secret(), 'refresh_token' => $tokens['refresh_token'] ) ) );
		if ( is_wp_error( $response ) ) { return $this->error( 'olist_refresh_failed', 'OLIST_TOKEN_REFRESH_FAILED', 'Falha de comunicação ao renovar autorização.', 'TOKEN_REFRESH', 0, 1, 'TOKEN' ); }
		$status = (int) wp_remote_retrieve_response_code( $response ); if ( 200 !== $status ) { return $this->error( 'olist_refresh_failed', 'OLIST_TOKEN_REFRESH_FAILED', 'Olist recusou a renovação da autorização.', 'TOKEN_REFRESH', $status, 1, 'TOKEN' ); }
		$body = json_decode( wp_remote_retrieve_body( $response ), true ); if ( ! is_array( $body ) || empty( $body['access_token'] ) || empty( $body['refresh_token'] ) ) { return $this->error( 'olist_invalid_token_response', 'OLIST_INVALID_JSON', 'Resposta de renovação inválida.', 'TOKEN_REFRESH', 200, 1, 'TOKEN' ); }
		if ( ! $this->tokens->save( (string) $body['access_token'], (string) $body['refresh_token'], absint( $body['expires_in'] ?? 14400 ) ) ) { return $this->error( 'olist_token_storage_failed', 'OLIST_TOKEN_REFRESH_FAILED', 'Não foi possível armazenar a autorização renovada.', 'TOKEN_REFRESH', 200, 1, 'TOKEN' ); } return (string) $body['access_token'];
	}
	private function error( string $code, string $technical, string $message, string $stage, int $http, int $attempt, string $endpoint, int $retry = 0 ): \WP_Error { return new \WP_Error( $code, $message, array( 'technical_code' => $technical, 'stage' => $stage, 'http_status' => $http, 'attempt' => $attempt, 'endpoint' => $endpoint, 'retry_after' => $retry ) ); }
	private function retry_after( $response ): int { $retry = absint( wp_remote_retrieve_header( $response, 'retry-after' ) ); if ( ! $retry ) { $reset = absint( wp_remote_retrieve_header( $response, 'x-ratelimit-reset' ) ); $retry = $reset > time() ? $reset - time() : $reset; } return min( 3600, max( 1, $retry ) ); }
	private function backoff( int $attempt ): void { $milliseconds = min( 2000, ( 250 * ( 2 ** max( 0, $attempt - 1 ) ) ) + random_int( 0, 150 ) ); usleep( $milliseconds * 1000 ); }
}
