<?php
namespace Persi\CatalogEngine\Attributes;
defined( 'ABSPATH' ) || exit;
final class AttributeDestinationResolver {
	public function resolve( string $concept, string $unit ): array {
		$automatic = array( 'bitola|in' => 'pa_bitola', 'bitola|inch' => 'pa_bitola', 'bitola|mm' => 'pa_bitola-em-milimetros' );
		$taxonomy = $automatic[ sanitize_key( $concept ) . '|' . strtolower( trim( $unit ) ) ] ?? CanonicalDictionary::taxonomy( $concept );
		return array( 'taxonomy' => $taxonomy && taxonomy_exists( $taxonomy ) ? $taxonomy : '', 'suggested_taxonomy' => $taxonomy, 'exists' => $taxonomy ? taxonomy_exists( $taxonomy ) : false, 'automatic' => isset( $automatic[ sanitize_key( $concept ) . '|' . strtolower( trim( $unit ) ) ] ) || 'medida_composta' === $concept );
	}
	public function automatic_rules(): array { $rules = array( array( 'concept' => 'bitola', 'unit' => 'Polegadas', 'taxonomy' => 'pa_bitola' ), array( 'concept' => 'bitola', 'unit' => 'Milímetros', 'taxonomy' => 'pa_bitola-em-milimetros' ), array( 'concept' => 'medida_composta', 'unit' => 'Composta', 'taxonomy' => 'pa_medida' ) ); foreach ( $rules as &$rule ) { $rule['configured'] = taxonomy_exists( $rule['taxonomy'] ); } unset( $rule ); return $rules; }
}
