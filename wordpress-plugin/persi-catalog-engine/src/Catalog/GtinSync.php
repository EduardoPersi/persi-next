<?php

namespace Persi\CatalogEngine\Catalog;

use Persi\CatalogEngine\Support\Statuses;
use Persi\CatalogEngine\Support\Performance;

defined( 'ABSPATH' ) || exit;

final class GtinSync {
	private ProductMatcher $matcher;
	private GtinValidator $validator;

	public function __construct( ?ProductMatcher $matcher = null, ?GtinValidator $validator = null ) {
		$this->matcher   = $matcher ?? new ProductMatcher();
		$this->validator = $validator ?? new GtinValidator();
	}

	public function process( \WC_Product $product, bool $dry_run ): array {
		$total_started = Performance::start(); $performance = array();
		$woo_started = Performance::start();
		$sku = trim( (string) $product->get_sku() );
		Performance::add( $performance, 'WOO_READ', Performance::elapsed_ms( $woo_started ) );
		if ( '' === $sku ) {
			Performance::add( $performance, 'GTIN_PIPELINE_TIME', Performance::elapsed_ms( $total_started ) );
			return array( 'status' => Statuses::NO_SKU, 'performance' => $performance );
		}

		$olist_started = Performance::start();
		$match = $this->matcher->match( $sku );
		Performance::add( $performance, ! empty( $match['cache_hit'] ) ? 'OLIST_CACHE_HIT' : 'OLIST_LOOKUP', Performance::elapsed_ms( $olist_started ) );
		if ( 'MATCHED' !== $match['status'] ) {
			$details = '';
			$retry   = 0;
			if ( isset( $match['error'] ) && is_wp_error( $match['error'] ) ) {
				$error_code = $match['error']->get_error_code();
				$error_data = $match['error']->get_error_data();
				$retry = is_array( $error_data ) ? absint( $error_data['retry_after'] ?? 0 ) : 0;
				$parts = array( (string) ( $error_data['technical_code'] ?? strtoupper( $error_code ) ), 'Etapa: ' . (string) ( $error_data['stage'] ?? 'SKU_LOOKUP' ), 'Endpoint: ' . (string) ( $error_data['endpoint'] ?? 'PRODUCT_SEARCH' ), 'Tentativa: ' . absint( $error_data['attempt'] ?? 1 ) );
				if ( ! empty( $error_data['http_status'] ) ) { $parts[] = 'HTTP: ' . absint( $error_data['http_status'] ); }
				$parts[] = sanitize_text_field( $match['error']->get_error_message() ); $details = implode( ' | ', $parts );
			}
			Performance::add( $performance, 'GTIN_PIPELINE_TIME', Performance::elapsed_ms( $total_started ) );
			return array( 'status' => $match['status'], 'details' => $details, 'error_code' => $error_code ?? '', 'retry_after' => $retry, 'performance' => $performance );
		}

		$validation_started = Performance::start();
		$olist     = $match['product'];
		$olist_id  = absint( $olist['id'] );
		$olist_gtin = $this->validator->normalize( $olist['gtin'] ?? '' );
		$woo_gtin  = trim( (string) $product->get_global_unique_id() );
		$base      = array( 'old_value' => $woo_gtin, 'new_value' => $olist_gtin, 'olist_product_id' => $olist_id );
		Performance::add( $performance, 'GTIN_VALIDATION', Performance::elapsed_ms( $validation_started ) );
		$base['performance'] = &$performance;

		if ( '' === $olist_gtin ) {
			Performance::add( $performance, 'GTIN_PIPELINE_TIME', Performance::elapsed_ms( $total_started ) );
			return array_merge( $base, array( 'status' => Statuses::OLIST_NO_GTIN ) );
		}
		if ( ! $this->validator->is_valid( $olist_gtin ) ) {
			Performance::add( $performance, 'GTIN_PIPELINE_TIME', Performance::elapsed_ms( $total_started ) );
			return array_merge( $base, array( 'status' => Statuses::INVALID_GTIN ) );
		}
		if ( '' !== $woo_gtin && hash_equals( $woo_gtin, $olist_gtin ) ) {
			Performance::add( $performance, 'GTIN_PIPELINE_TIME', Performance::elapsed_ms( $total_started ) );
			return array_merge( $base, array( 'status' => Statuses::ALREADY_SYNCED ) );
		}
		if ( '' !== $woo_gtin ) {
			Performance::add( $performance, 'GTIN_PIPELINE_TIME', Performance::elapsed_ms( $total_started ) );
			return array_merge( $base, array( 'status' => Statuses::GTIN_CONFLICT ) );
		}
		if ( $dry_run ) {
			Performance::add( $performance, 'GTIN_PIPELINE_TIME', Performance::elapsed_ms( $total_started ) );
			return array_merge( $base, array( 'status' => Statuses::WOULD_UPDATE ) );
		}

		$write_started = Performance::start();
		try {
			$product->set_global_unique_id( $olist_gtin );
			$product->save();
		} catch ( \Throwable $exception ) {
			Performance::add( $performance, 'WOO_WRITE', Performance::elapsed_ms( $write_started ) );
			Performance::add( $performance, 'GTIN_PIPELINE_TIME', Performance::elapsed_ms( $total_started ) );
			return array_merge( $base, array( 'status' => Statuses::SKIPPED, 'details' => 'woocommerce_write_failed' ) );
		}
		Performance::add( $performance, 'WOO_WRITE', Performance::elapsed_ms( $write_started ) );
		Performance::add( $performance, 'GTIN_PIPELINE_TIME', Performance::elapsed_ms( $total_started ) );

		return array_merge( $base, array( 'status' => Statuses::UPDATED ) );
	}
}
