<?php

namespace Persi\CatalogEngine\Attributes;

defined( 'ABSPATH' ) || exit;

final class WooAttributeTermResolver {
	private NormalizationService $normalizer;
	private array $indexes = array();

	public function __construct() { $this->normalizer = new NormalizationService(); }

	public function resolve( string $concept, string $value, string $unit, string $taxonomy ): array {
		if ( ! $taxonomy || ! taxonomy_exists( $taxonomy ) ) { return array( 'term' => '', 'status' => AttributeStatuses::TERM_MAPPING_REQUIRED ); }
		if ( ! isset( $this->indexes[ $taxonomy ][ $concept ] ) ) { $this->indexes[ $taxonomy ][ $concept ] = $this->index( $taxonomy, $concept ); }
		$key = $this->key( $concept, $value );
		$term = $this->indexes[ $taxonomy ][ $concept ][ $key ] ?? '';
		return array( 'term' => $term, 'status' => $term ? AttributeStatuses::TERM_MATCHED : AttributeStatuses::CANDIDATE );
	}

	private function index( string $taxonomy, string $concept ): array {
		$terms = get_terms( array( 'taxonomy' => $taxonomy, 'hide_empty' => false ) );
		if ( is_wp_error( $terms ) ) { return array(); }
		$index = array();
		foreach ( $terms as $term ) {
			$index[ $this->key( $concept, $term->name ) ] = $term->name;
			if ( 'bitola' === $concept && preg_match( '/^\d+(?:[,.]\d+)?$/', trim( $term->name ) ) ) { $index[ $this->key( $concept, $term->name . ' mm' ) ] = $term->name; }
		}
		return $index;
	}

	private function key( string $concept, string $value ): string { return strtolower( remove_accents( trim( $this->normalizer->normalize( $concept, $value )['normalized_value'] ) ) ); }
}
