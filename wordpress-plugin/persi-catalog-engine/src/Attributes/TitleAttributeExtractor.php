<?php
namespace Persi\CatalogEngine\Attributes;
defined( 'ABSPATH' ) || exit;
final class TitleAttributeExtractor {
	private NormalizationService $normalizer;
	public function __construct() { $this->normalizer = new NormalizationService(); }
	public function extract( string $title, array $context ): array {
		$family = (string) $context['family']; $result = ( new CompositeDimensionParser() )->extract( $title, $context ); $scan_title = $this->without_consumed_spans( $title, $result );
		$patterns = array(
			'secao_condutor' => array( '/\b\d+(?:[,.]\d+)?\s*mm(?:²|2)\b/iu', 'title_conductor_section' ),
			'potencia_aparente' => array( '/(?<![\p{L}\p{N}])\d+(?:[,.]\d+)?\s*(?:kVA|VA)(?![\p{L}\p{N}])/iu', 'title_apparent_power' ),
			'potencia' => array( '/(?<![\p{L}\p{N}])(?:\d+\s*\/\s*\d+|\d+(?:[,.]\d+)?)\s*(?:CV|HP|kW|W|watts?)(?![\p{L}\p{N}])/iu', 'title_power' ),
			'tensao' => array( '/(?<![\p{L}\p{N}])(?:\d+\s*[\/-]\s*\d+|\d+)\s*V(?![\p{L}\p{N}])|\bbi\s*-?\s*volts?\b/iu', 'title_voltage' ),
			'corrente_nominal' => array( '/(?<![\p{L}\p{N}])\d+(?:[,.]\d+)?\s*(?:A|amp[eè]res?)(?![\p{L}\p{N}])/iu', 'title_current' ),
			'numero_polos' => array( '/(?<![\p{L}\p{N}])(?:[1-4]\s*P|Unipolar|Monopolar|Bipolar|Tripolar|Tetrapolar)(?![\p{L}\p{N}])/iu', 'title_poles' ),
			'fase' => array( '/(?<![\p{L}\p{N}])(?:Mono(?:fásic[oa])?|Tri(?:fásic[oa])?)(?![\p{L}\p{N}])/iu', 'title_phase' ),
			'comprimento' => array( '/(?<![\p{L}\p{N}])\d+(?:[,.]\d+)?\s*(?:m|metros?)(?!m|²|2|[\p{L}\p{N}])/iu', 'title_length' ),
		);
		foreach ( $patterns as $concept => [$pattern, $rule] ) { if ( DiscoveryRules::allows( $family, $concept ) && preg_match_all( $pattern, $scan_title, $matches ) ) { foreach ( array_unique( $matches[0] ) as $raw ) { $result[] = $this->candidate( $concept, $raw, $title, 'HIGH_CONTEXT', $rule ); } } }
		if ( DiscoveryRules::allows( $family, 'cor' ) ) { foreach ( DiscoveryRules::COLORS as $needle => $color ) { if ( preg_match( '/(?<![\p{L}\p{N}])' . preg_quote( $needle, '/' ) . '(?![\p{L}\p{N}])/iu', remove_accents( $title ), $match ) ) { $result[] = $this->candidate( 'cor', $match[0], $title, 'generic' === $family ? 'MEDIUM_CONTEXT' : 'HIGH_CONTEXT', 'title_color' ); break; } } }
		if ( in_array( $family, array( 'hydraulic_pipe', 'hydraulic_fitting' ), true ) ) {
			if ( preg_match_all( '/(?:\b(?:DN\s*)?\d+(?:[,.]\d+)?\s*mm(?!\s*(?:²|2))|(?<![\d\/])(?:(?:\d+[ .])?\d+\s*\/\s*\d+|\d+)\s*(?:"|”|polegadas?|pol\.?))/iu', $scan_title, $matches ) ) { foreach ( $matches[0] as $raw ) { $result[] = $this->candidate( 'bitola', $raw, $title, 'HIGH_CONTEXT', false !== stripos( $raw, 'mm' ) ? 'millimeter_dimension_pattern' : 'inch_dimension_pattern' ); } }
			if ( preg_match( '/\bDN\s*\d+\s*X\s*\d+\b/iu', $title, $dn ) ) { $candidate = $this->candidate( 'dn_composto', $dn[0], $title, 'REVIEW_REQUIRED', 'dn_pattern' ); $candidate['source'] = 'REJECTED_DISCOVERY'; $candidate['status'] = AttributeStatuses::CONCEPT_AMBIGUOUS; $candidate['evidence'] .= ' | DN composto preservado sem inventar unidade.'; $result[] = $candidate; }
		}
		if ( preg_match( '/placa\s+ciment[ií]cia/iu', $title ) && preg_match( '/\b\d+(?:[,.]\d+)?\s*mm(?!\s*(?:²|2))/iu', $title, $match ) ) { $result[] = $this->rejected( 'espessura', $match[0], $title, 'plate_thickness_pattern', 'Categoria/família incompatível com regra de bitola.' ); }
		if ( preg_match( '/\b(?:trena|measuring\s+tape)\b/iu', $title ) ) { if ( preg_match( '/\b\d+(?:[,.]\d+)?\s*m(?!m)/iu', $title, $match ) ) { $result[] = $this->candidate( 'comprimento', $match[0], $title, 'HIGH_CONTEXT', 'tape_length_pattern' ); } if ( preg_match( '/\b\d+(?:[,.]\d+)?\s*mm/iu', $title, $match ) ) { $result[] = $this->rejected( 'largura_fita', $match[0], $title, 'tape_width_pattern', 'Medida identificada como largura da fita, não como bitola.' ); } }
		if ( 'tool' === $family && preg_match( '/\b\d+(?:[,.]\d+)?\s*mm(?!\s*(?:²|2))/iu', $title, $match ) ) { $result[] = $this->candidate( 'diametro', $match[0], $title, 'HIGH_CONTEXT', 'title_tool_diameter' ); }
		if ( 'generic' === $family && preg_match( '/\b\d+(?:[,.]\d+)?\s*mm(?!\s*(?:²|2))/iu', $title, $match ) ) { $candidate = $this->candidate( 'medida_nao_classificada', $match[0], $title, 'REVIEW_REQUIRED', 'title_ambiguous_measurement' ); $candidate['status'] = AttributeStatuses::CONCEPT_AMBIGUOUS; $result[] = $candidate; }
		return $result;
	}
	private function without_consumed_spans( string $title, array $candidates ): string { $masked = $title; foreach ( $candidates as $candidate ) { $span = $candidate['consumed_span'] ?? null; if ( ! is_array( $span ) || (int) ( $span['length'] ?? 0 ) < 1 ) { continue; } $length = (int) $span['length']; $masked = substr_replace( $masked, str_repeat( ' ', $length ), (int) $span['offset'], $length ); } return $masked; }
	private function candidate( string $concept, string $raw, string $evidence, string $confidence, string $rule ): array { return array_merge( array( 'attribute_key' => $concept, 'raw_value' => trim( $raw ), 'source' => 'TITLE_PATTERN', 'source_field' => 'title', 'evidence' => mb_substr( $evidence, 0, 300 ), 'match_value' => trim( $raw ), 'confidence' => $confidence, 'status' => AttributeStatuses::CANDIDATE, 'rule_id' => $rule, 'ruleset_version' => DiscoveryRules::VERSION ), $this->normalizer->normalize( $concept, $raw ) ); }
	private function rejected( string $concept, string $raw, string $text, string $rule, string $reason ): array { $candidate = $this->candidate( $concept, $raw, $text . ' | Bitola rejeitada: ' . $reason, 'HIGH_CONTEXT', $rule ); $candidate['source'] = 'REJECTED_DISCOVERY'; $candidate['status'] = AttributeStatuses::MAPPING_REQUIRED; return $candidate; }
}
