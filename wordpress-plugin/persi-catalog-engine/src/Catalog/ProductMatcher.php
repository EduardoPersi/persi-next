<?php

namespace Persi\CatalogEngine\Catalog;

use Persi\CatalogEngine\Api\OlistClient;
use Persi\CatalogEngine\Support\Statuses;
use Persi\CatalogEngine\Infrastructure\OlistSnapshotRepository;

defined( 'ABSPATH' ) || exit;

class ProductMatcher {
	private OlistClient $client;

	public function __construct( ?OlistClient $client = null ) {
		$this->client = $client ?? new OlistClient();
	}

	public function match( string $sku ): array {
		$cache = new OlistSnapshotRepository();
		$cached = $cache->by_sku( $sku );
		if ( $cached && isset( $cached['id'], $cached['sku'] ) && (string) $cached['sku'] === $sku ) {
			return array( 'status' => 'MATCHED', 'product' => $cached, 'cache_hit' => true );
		}
		$items = $this->client->find_by_sku( $sku );
		if ( is_wp_error( $items ) ) {
			return array( 'status' => Statuses::API_ERROR, 'error' => $items );
		}

		$exact = array_values(
			array_filter(
				$items,
				static fn( array $item ): bool => isset( $item['sku'] ) && (string) $item['sku'] === $sku
			)
		);
		if ( 0 === count( $exact ) ) {
			return array( 'status' => Statuses::OLIST_NOT_FOUND );
		}
		if ( 1 !== count( $exact ) ) {
			return array( 'status' => Statuses::AMBIGUOUS_MATCH );
		}

		$cache->save( $sku, absint( $exact[0]['id'] ), $exact[0] );
		return array( 'status' => 'MATCHED', 'product' => $exact[0], 'cache_hit' => false );
	}
}
