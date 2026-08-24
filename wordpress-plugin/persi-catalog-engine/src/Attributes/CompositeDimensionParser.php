<?php
namespace Persi\CatalogEngine\Attributes;
defined( 'ABSPATH' ) || exit;
final class CompositeDimensionParser {
	private NormalizationService $normalizer;
	public function __construct() { $this->normalizer = new NormalizationService(); }
	public function extract( string $text, array $context ): array {
		if ( 'hydraulic_fitting' !== ( $context['family'] ?? '' ) ) { return array(); }
		$token = '(?:(?:\d+[ .])?\d+\s*\/\s*\d+|\d+(?:[,.]\d+)?)\s*(?:mm|"|”|pol\.?|polegadas?)?';
		$pattern = '/(?<![\p{L}\p{N}])(' . $token . ')\s*[x×]\s*(' . $token . ')(?:\s*[x×]\s*(' . $token . '))?/iu';
		if ( ! preg_match_all( $pattern, $text, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE ) ) { return array(); }
		$result = array();
		foreach ( $matches as $match ) {
			$raw_parts = array_values( array_filter( array_map( static fn( array $capture ): string => trim( $capture[0] ), array_slice( $match, 1, 3 ) ), static fn( string $part ): bool => '' !== $part ) );
			if ( count( $raw_parts ) < 2 ) { continue; }
			$explicit = array_map( array( $this, 'unit' ), $raw_parts ); if ( ! array_filter( $explicit ) ) { continue; }
			$last_unit = ''; foreach ( array_reverse( $explicit ) as $unit ) { if ( $unit ) { $last_unit = $unit; break; } }
			$components = array();
			foreach ( $raw_parts as $position => $raw ) {
				$unit = $explicit[ $position ] ?: ( 'in' === $last_unit ? 'mm' : $last_unit ); if ( ! $unit ) { $components = array(); break; }
				$with_unit = $raw; if ( ! $explicit[ $position ] ) { $with_unit .= 'mm' === $unit ? 'mm' : '"'; }
				$normalized = $this->normalizer->normalize( 'bitola', $with_unit );
				$components[] = array( 'position' => $position, 'raw_value' => $raw, 'value' => $normalized['numeric_value'], 'unit' => $unit, 'canonical' => $normalized['normalized_value'], 'unit_source' => $explicit[ $position ] ? 'EXPLICIT' : 'COMPOSITE_CONTEXT_INFERENCE' );
			}
			if ( count( $components ) < 2 ) { continue; }
			$canonical = implode( 'x', array_map( array( $this, 'commercial' ), $components ) );
			$result[] = array(
				'attribute_key' => 'medida_composta', 'raw_value' => trim( $match[0][0] ), 'display_value' => implode( ' x ', array_map( array( $this, 'commercial' ), $components ) ),
				'normalized_value' => $canonical, 'numeric_value' => null, 'unit' => 'composite', 'source' => 'TITLE_PATTERN', 'source_field' => 'title',
				'evidence' => mb_substr( $text, 0, 300 ), 'confidence' => 'HIGH_CONTEXT', 'status' => AttributeStatuses::CANDIDATE,
				'rule_id' => 'composite_dimension_pattern', 'ruleset_version' => DiscoveryRules::VERSION,
				'unit_source' => in_array( '', $explicit, true ) ? 'COMPOSITE_UNIT_PROPAGATION' : 'EXPLICIT', 'components' => $components,
				'search_aliases' => $this->aliases( $components, $canonical ),
				'consumed_span' => array( 'offset' => $match[0][1], 'length' => strlen( $match[0][0] ), 'policy' => 'COMPOSITE_CONSUMES_COMPONENTS' ),
			);
		}
		return $result;
	}
	private function unit( string $value ): string { if ( preg_match( '/(?:"|”|\bpol\.?|polegadas?)/iu', $value ) ) { return 'in'; } return false !== stripos( $value, 'mm' ) ? 'mm' : ''; }
	private function commercial( array $component, bool $with_metric = true ): string { $value = 'mm' === $component['unit'] ? preg_replace( '/\s*mm$/i', '', $component['canonical'] ) : preg_replace( '/["”]$/u', '', $component['canonical'] ); return 'mm' === $component['unit'] ? $value . ( $with_metric ? 'mm' : '' ) : $value . '"'; }
	private function aliases( array $components, string $canonical ): array { $without_metric = array_map( fn( array $part ): string => $this->commercial( $part, false ), $components ); $last_metric = $without_metric; $last = count( $components ) - 1; if ( 'mm' === $components[ $last ]['unit'] ) { $last_metric[ $last ] .= 'mm'; } $variants = array( $canonical, implode( ' x ', array_map( array( $this, 'commercial' ), $components ) ), implode( 'x', $last_metric ), implode( ' x ', $last_metric ), implode( 'x', $without_metric ), implode( ' x ', $without_metric ) ); foreach ( array_values( $variants ) as $variant ) { $variants[] = str_replace( '"', '', $variant ); } return array_values( array_unique( $variants ) ); }
}
