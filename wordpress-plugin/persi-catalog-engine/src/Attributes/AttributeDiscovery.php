<?php

namespace Persi\CatalogEngine\Attributes;

use Persi\CatalogEngine\Api\OlistClient;
use Persi\CatalogEngine\Catalog\ProductMatcher;
use Persi\CatalogEngine\Infrastructure\AttributeMappingRepository;

defined( 'ABSPATH' ) || exit;

final class AttributeDiscovery {
	private ProductFamilyContext $contexts;
	private NormalizationService $normalizer;
	private AttributeMappingRepository $mappings;
	private WooAttributeTermResolver $terms;
	private AttributeDestinationResolver $destinations;
	public function __construct() { $this->contexts = new ProductFamilyContext(); $this->normalizer = new NormalizationService(); $this->mappings = new AttributeMappingRepository(); $this->terms = new WooAttributeTermResolver(); $this->destinations = new AttributeDestinationResolver(); }

	public function discover( \WC_Product $product, bool $include_olist = true ): array {
		$parent = $product->get_parent_id() ? wc_get_product( $product->get_parent_id() ) : $product;
		$target = $parent ?: $product; $context = $this->contexts->resolve( $target );
		$candidates = array_merge( $this->woo_existing( $target ), $include_olist ? $this->olist_structured( $product, $context ) : array(), ( new DescriptionAttributeExtractor() )->extract( (string) $target->get_description(), $context ), ( new TitleAttributeExtractor() )->extract( $target->get_name(), $context ) );
		return $this->classify( $target, $this->deduplicate( $candidates ), $context );
	}

	private function woo_existing( \WC_Product $product ): array {
		$result = array();
		foreach ( $product->get_attributes() as $attribute ) {
			$name = $attribute->get_name(); $label = wc_attribute_label( $name ); $key = CanonicalDictionary::suggest_key( $label ); $raw = $product->get_attribute( $name );
			if ( ! $key || '' === trim( $raw ) ) { continue; }
			$result[] = array_merge( array( 'attribute_key' => $key, 'raw_value' => $raw, 'source' => 'WOO_EXISTING', 'source_field' => $label, 'evidence' => mb_substr( $label . ': ' . $raw, 0, 300 ), 'confidence' => 'EXACT_STRUCTURED', 'woo_taxonomy' => 0 === strpos( $name, 'pa_' ) ? $name : '', 'status' => AttributeStatuses::ALREADY_SYNCED, 'rule_id' => 'woo_existing_attribute', 'ruleset_version' => DiscoveryRules::VERSION ), $this->normalizer->normalize( $key, $raw ) );
		}
		return $result;
	}

	private function olist_structured( \WC_Product $product, array $context ): array {
		$sku = trim( (string) $product->get_sku() ); if ( ! $sku ) { return array(); }
		$match = ( new ProductMatcher() )->match( $sku ); if ( 'MATCHED' !== ( $match['status'] ?? '' ) ) { return array(); }
		$detail = ( new OlistClient() )->product_detail( absint( $match['product']['id'] ?? 0 ) ); if ( is_wp_error( $detail ) ) { return array(); }
		$flat = array(); $this->flatten( $detail, '', $flat ); $result = array();
		foreach ( $flat as $path => $raw ) {
			if ( is_array( $raw ) || is_object( $raw ) || '' === trim( (string) $raw ) ) { continue; }
			$origin = (string) preg_replace( '/^.*\./', '', $path ); $mapping = $this->mappings->resolve( $origin, $context['category_ids'], $context['family'] );
			$key = $mapping ? (string) $mapping->attribute_key : CanonicalDictionary::suggest_key( $origin ); if ( ! $key ) { continue; }
			$result[] = array_merge( array( 'attribute_key' => $key, 'raw_value' => (string) $raw, 'source' => $mapping ? 'MANUAL_MAPPING' : 'OLIST_STRUCTURED', 'source_field' => $origin, 'evidence' => mb_substr( $path . ': ' . (string) $raw, 0, 300 ), 'confidence' => 'EXACT_STRUCTURED', 'woo_taxonomy' => $mapping ? (string) $mapping->woo_taxonomy : '', 'status' => AttributeStatuses::CANDIDATE, 'rule_id' => $mapping ? 'manual_source_mapping' : 'olist_canonical_alias', 'ruleset_version' => DiscoveryRules::VERSION ), $this->normalizer->normalize( $key, (string) $raw ) );
		}
		return $result;
	}

	private function classify( \WC_Product $product, array $candidates, array $context ): array {
		$values = array(); foreach ( $candidates as $candidate ) { if ( '' !== (string) ( $candidate['normalized_value'] ?? '' ) ) { $semantic_key = $candidate['attribute_key'] . '|' . ( $candidate['unit'] ?? '' ); $values[ $semantic_key ][ strtolower( remove_accents( $candidate['normalized_value'] ) ) ] = true; } }
		foreach ( $candidates as &$candidate ) {
			$candidate['category'] = $context['category']; $candidate['family'] = $context['family']; $candidate['family_label'] = $context['family_label'];
			$candidate['evidence'] = mb_substr( (string) ( $candidate['evidence'] ?? '' ) . ' | Contexto: ' . $context['family_label'], 0, 500 );
			if ( ! empty( $candidate['components'] ) ) { $component_text = implode( ' + ', array_column( $candidate['components'], 'canonical' ) ); $alias_text = implode( ', ', $candidate['search_aliases'] ?? array() ); $candidate['evidence'] = mb_substr( $candidate['evidence'] . ' | Componentes: ' . $component_text . ' | Aliases: ' . $alias_text, 0, 500 ); }
			if ( AttributeStatuses::UNSUPPORTED_CONTEXT === ( $candidate['status'] ?? '' ) ) { continue; }
			$key = $candidate['attribute_key']; $taxonomy = (string) ( $candidate['woo_taxonomy'] ?? '' );
			$mapping = $this->mappings->resolve( (string) ( $candidate['source_field'] ?? '' ), $context['category_ids'], $context['family'] ); if ( ! $mapping ) { $mapping = $this->mappings->resolve( $key, $context['category_ids'], $context['family'] ); } if ( $mapping ) { $taxonomy = (string) $mapping->woo_taxonomy; }
			$destination = $this->destinations->resolve( $key, (string) ( $candidate['unit'] ?? '' ) ); if ( ! $taxonomy ) { $taxonomy = $destination['taxonomy'] ?: ( 'medida_composta' === $key ? $destination['suggested_taxonomy'] : '' ); }
			$candidate['destination_rule'] = $destination['automatic'] ? 'concept_unit' : ( $mapping ? 'manual_mapping' : 'canonical_dictionary' );
			$candidate['woo_taxonomy'] = $taxonomy;
			$semantic_key = $key . '|' . ( $candidate['unit'] ?? '' ); if ( 'composite_dimension_component' !== ( $candidate['rule_id'] ?? '' ) && count( $values[ $semantic_key ] ?? array() ) > 1 ) { $candidate['status'] = AttributeStatuses::SOURCE_CONFLICT; continue; }
			if ( 'WOO_EXISTING' === $candidate['source'] ) { $candidate['status'] = AttributeStatuses::ALREADY_SYNCED; $candidate['old_value'] = $candidate['raw_value']; continue; }
			if ( 'medida_composta' === $key && ( ! $taxonomy || ! taxonomy_exists( $taxonomy ) ) ) { $candidate['woo_taxonomy'] = 'pa_medida'; $candidate['status'] = AttributeStatuses::DESTINATION_MISSING; continue; }
			if ( ! $taxonomy || ! taxonomy_exists( $taxonomy ) ) { $candidate['status'] = AttributeStatuses::MAPPING_REQUIRED; continue; }
			$old = (string) $product->get_attribute( $taxonomy ); $candidate['old_value'] = $old; $resolved = $this->terms->resolve( $key, $candidate['normalized_value'], (string) ( $candidate['unit'] ?? '' ), $taxonomy ); $candidate['existing_term'] = $resolved['term'];
			if ( '' !== $old ) { $candidate['status'] = $this->equivalent( $key, $old, $candidate['normalized_value'] ) ? AttributeStatuses::ALREADY_SYNCED : AttributeStatuses::CONFLICT; }
			elseif ( in_array( $candidate['confidence'], array( 'REVIEW_REQUIRED', 'MEDIUM_CONTEXTUAL', 'MEDIUM_CONTEXT', 'LOW_CONTEXT' ), true ) ) { $candidate['status'] = AttributeStatuses::REVIEW_REQUIRED; }
			else { $candidate['status'] = $resolved['status']; }
		}
		unset( $candidate ); return $candidates;
	}

	private function equivalent( string $key, string $left, string $right ): bool { return strtolower( remove_accents( $this->normalizer->normalize( $key, $left )['normalized_value'] ) ) === strtolower( remove_accents( $this->normalizer->normalize( $key, $right )['normalized_value'] ) ); }
	private function flatten( $value, string $path, array &$flat ): void { if ( ! is_array( $value ) ) { $flat[ $path ] = $value; return; } foreach ( $value as $key => $item ) { $next = $path ? $path . '.' . ( is_int( $key ) ? '[]' : $key ) : (string) $key; $this->flatten( $item, $next, $flat ); } }
	private function deduplicate( array $items ): array { $seen = array(); $result = array(); foreach ( $items as $item ) { $key = ( $item['attribute_key'] ?? '' ) . '|' . ( $item['normalized_value'] ?? '' ) . '|' . ( $item['source'] ?? '' ); if ( isset( $seen[ $key ] ) ) { continue; } $seen[ $key ] = true; $result[] = $item; } return $result; }
}
