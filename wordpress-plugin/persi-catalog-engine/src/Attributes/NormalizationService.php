<?php
namespace Persi\CatalogEngine\Attributes;
defined( 'ABSPATH' ) || exit;
final class NormalizationService {
	public function normalize( string $concept, string $raw ): array {
		$value = trim( html_entity_decode( $raw, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
		$value = str_replace( array( '½', '¾', '¼' ), array( '1/2', '3/4', '1/4' ), $value ); $plain = strtolower( remove_accents( $value ) );
		if ( 'cor' === $concept ) { return array( 'normalized_value' => $this->color( $plain, $value ), 'numeric_value' => null, 'unit' => '' ); }
		if ( 'fase' === $concept ) { if ( preg_match( '/\b(?:mono|monofasico|monofasica)\b/i', $plain ) ) { return array( 'normalized_value' => 'Monofásica', 'numeric_value' => 1, 'unit' => 'fase' ); } if ( preg_match( '/\b(?:tri|trif|trifasico|trifasica)\b/i', $plain ) ) { return array( 'normalized_value' => 'Trifásica', 'numeric_value' => 3, 'unit' => 'fase' ); } }
		if ( 'numero_polos' === $concept ) { $map = array( 'unipolar' => 1, 'monopolar' => 1, 'bipolar' => 2, 'tripolar' => 3, 'tetrapolar' => 4 ); $number = 0; foreach ( $map as $word => $count ) { if ( false !== strpos( $plain, $word ) ) { $number = $count; break; } } if ( ! $number && preg_match( '/\b([1-4])\s*p\b/i', $plain, $match ) ) { $number = (int) $match[1]; } return array( 'normalized_value' => $number . ( 1 === $number ? ' Polo' : ' Polos' ), 'numeric_value' => $number, 'unit' => 'polo' ); }
		if ( 'potencia' === $concept && preg_match( '/(\d+)\s*\/\s*(\d+)\s*(cv|hp)/i', $plain, $fraction ) ) { return $this->number( (float) $fraction[1] / max( 1, (float) $fraction[2] ), strtoupper( $fraction[3] ) ); }
		if ( 'tensao' === $concept && preg_match( '/bi\s*-?\s*volts?/i', $plain ) ) { return array( 'normalized_value' => 'Bivolt', 'numeric_value' => null, 'unit' => 'V' ); }
		$power_unit = ''; if ( in_array( $concept, array( 'potencia', 'potencia_aparente' ), true ) && preg_match( '/(?:^|[^a-z])(kva|va|kw|cv|hp|watts?|w)(?:$|[^a-z])/i', $plain, $power_match ) ) { $power_unit = array( 'kva' => 'kVA', 'va' => 'VA', 'kw' => 'kW', 'cv' => 'CV', 'hp' => 'HP', 'watt' => 'W', 'watts' => 'W', 'w' => 'W' )[ strtolower( $power_match[1] ) ] ?? ''; }
		$is_inch = (bool) preg_match( '/(?:"|”|\bpolegadas?\b|\bpol\.?)/iu', $value ); $unit_map = array( 'corrente_nominal' => 'A', 'potencia' => $power_unit, 'potencia_aparente' => $power_unit, 'tensao' => 'V', 'bitola' => $is_inch ? 'in' : 'mm', 'secao_condutor' => 'mm²', 'secao_nominal' => 'mm²', 'comprimento' => 'm', 'diametro' => 'mm', 'rosca' => 'in', 'espessura' => 'mm', 'largura_fita' => 'mm' ); $unit = $unit_map[ $concept ] ?? '';
		if ( 'in' === $unit ) { $inch = trim( preg_replace( '/\s*(?:"|”|polegadas?|pol\.?)$/iu', '', $value ) ); $inch = preg_replace( '/^(\d+)\.(\d+\/\d+)$/', '$1 $2', $inch ); return array( 'normalized_value' => $inch . '"', 'numeric_value' => null, 'unit' => 'in' ); }
		if ( 'tensao' === $concept && preg_match( '/(\d+)\s*([\/-])\s*(\d+)/', $plain, $compound ) ) { return array( 'normalized_value' => $compound[1] . $compound[2] . $compound[3] . ' V', 'numeric_value' => null, 'unit' => 'V' ); }
		$number_text = preg_match( '/\d+(?:[,.]\d+)?/', $plain, $number_match ) ? $number_match[0] : ''; $numeric = '' === $number_text ? null : (float) str_replace( ',', '.', $number_text ); return null === $numeric ? array( 'normalized_value' => trim( $value ), 'numeric_value' => null, 'unit' => $unit ) : $this->number( $numeric, $unit );
	}
	private function number( float $number, string $unit ): array { $display = rtrim( rtrim( number_format( $number, 4, ',', '' ), '0' ), ',' ); return array( 'normalized_value' => trim( $display . ' ' . $unit ), 'numeric_value' => $number, 'unit' => $unit ); }
	private function color( string $plain, string $raw ): string { foreach ( DiscoveryRules::COLOR_ALIASES as $alias => $color ) { if ( trim( $plain, " .\t\n\r\0\x0B" ) === trim( $alias, '.' ) ) { return $color; } } foreach ( DiscoveryRules::COLORS as $needle => $color ) { if ( preg_match( '/(?<![\p{L}\p{N}])' . preg_quote( $needle, '/' ) . '(?![\p{L}\p{N}])/iu', $plain ) ) { return $color; } } return trim( $raw ); }
}
