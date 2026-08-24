<?php

namespace Persi\CatalogEngine\Api;

defined( 'ABSPATH' ) || exit;

final class Configuration {
	public const API_BASE  = 'https://api.tiny.com.br/public-api/v3';
	public const TOKEN_URL = 'https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token';

	public function client_id(): string {
		return defined( 'PERSI_CATALOG_OLIST_CLIENT_ID' ) ? trim( (string) constant( 'PERSI_CATALOG_OLIST_CLIENT_ID' ) ) : '';
	}

	public function client_secret(): string {
		return defined( 'PERSI_CATALOG_OLIST_CLIENT_SECRET' ) ? trim( (string) constant( 'PERSI_CATALOG_OLIST_CLIENT_SECRET' ) ) : '';
	}

	public function redirect_uri(): string {
		return admin_url( 'admin-post.php?action=persi_catalog_olist_callback' );
	}

	public function configured(): bool {
		return '' !== $this->client_id() && '' !== $this->client_secret();
	}

	public function batch_size(): int {
		$size = defined( 'PERSI_CATALOG_BATCH_SIZE' ) ? absint( constant( 'PERSI_CATALOG_BATCH_SIZE' ) ) : 20;
		return min( 100, max( 1, $size ) );
	}

	public function worker_budget_seconds(): int {
		$seconds = defined( 'PERSI_CATALOG_WORKER_BUDGET_SECONDS' ) ? absint( constant( 'PERSI_CATALOG_WORKER_BUDGET_SECONDS' ) ) : 25;
		return min( 30, max( 5, $seconds ) );
	}

	public function cache_ttl_seconds(): int {
		$seconds = defined( 'PERSI_CATALOG_OLIST_CACHE_TTL' ) ? absint( constant( 'PERSI_CATALOG_OLIST_CACHE_TTL' ) ) : 15 * MINUTE_IN_SECONDS;
		return min( DAY_IN_SECONDS, max( MINUTE_IN_SECONDS, $seconds ) );
	}
}
