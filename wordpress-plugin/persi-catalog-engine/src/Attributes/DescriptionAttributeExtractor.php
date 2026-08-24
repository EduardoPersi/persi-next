<?php
namespace Persi\CatalogEngine\Attributes;
defined( 'ABSPATH' ) || exit;
final class DescriptionAttributeExtractor {
	private NormalizationService $normalizer;
	public function __construct() { $this->normalizer = new NormalizationService(); }
	public function extract( string $description, array $context ): array {
		$text = html_entity_decode( wp_strip_all_tags( str_replace( array( '<br>', '<br/>', '<br />', '</p>' ), "\n", $description ) ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$text = trim( preg_replace( '/[ \t]+/u', ' ', $text ) ); if ( '' === $text ) { return array(); }
		$aliases = array( 'corrente(?: nominal)?|amperagem' => 'corrente_nominal', 'potência aparente' => 'potencia_aparente', 'potência(?: nominal)?' => 'potencia', 'tensão|voltagem' => 'tensao', 'bitola|diâmetro nominal' => 'bitola', 'seção(?: do condutor| nominal)?' => 'secao_condutor', 'número de polos|polos' => 'numero_polos', 'fase' => 'fase', 'comprimento' => 'comprimento', 'diâmetro' => 'diametro', 'rosca' => 'rosca', 'cor' => 'cor' );
		$result = array(); foreach ( $aliases as $label => $concept ) { $pattern = '/(?:^|[\r\n;])\s*(' . $label . ')\s*(?::|=|-|\t|\s)\s*([^\r\n;]{1,60})/iu'; if ( ! preg_match_all( $pattern, $text, $matches, PREG_SET_ORDER ) ) { continue; } foreach ( $matches as $match ) { $raw = trim( $match[2] ); $result[] = array_merge( array( 'attribute_key' => $concept, 'raw_value' => $raw, 'source' => 'DESCRIPTION_LABEL_VALUE', 'source_field' => trim( $match[1] ), 'evidence' => mb_substr( trim( $match[0] ), 0, 300 ), 'match_value' => $raw, 'confidence' => 'EXACT_STRUCTURED', 'status' => AttributeStatuses::CANDIDATE, 'rule_id' => 'description_label_value', 'ruleset_version' => DiscoveryRules::VERSION ), $this->normalizer->normalize( $concept, $raw ) ); } }
		return $result;
	}
}
