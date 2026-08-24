<?php

namespace Persi\CatalogEngine\Attributes;

defined( 'ABSPATH' ) || exit;

final class ProductFamilyContext {
	private const LABELS = array( 'electrical_breaker' => 'Disjuntores elétricos', 'electrical_wire_cable' => 'Fios e cabos elétricos', 'electrical_switchgear' => 'Dispositivos elétricos', 'hydraulic_pipe' => 'Tubos hidráulicos', 'hydraulic_fitting' => 'Conexões hidráulicas', 'pump' => 'Bombas', 'shower' => 'Chuveiros', 'tool' => 'Ferramentas', 'generic' => 'Genérica' );
	private const ALIASES = array(
		'electrical_breaker' => array( 'disjuntor', 'protecao eletrica', 'dps', 'interruptor diferencial', 'dr ' ),
		'electrical_wire_cable' => array( 'cabo flexivel', 'cabos eletricos', 'fio eletrico', 'fios eletricos' ),
		'electrical_switchgear' => array( 'contator', 'interruptor', 'condulete', 'quadro eletrico', 'transformador' ),
		'hydraulic_pipe' => array( 'tubo pvc', 'tubos pvc', 'cano pvc', 'eletroduto' ),
		'hydraulic_fitting' => array( 'hidraulica', 'conexao', 'conexoes', 'reducao', 'bucha', 'curva', 'joelho', 'luva', 'adaptador', 'te ', 'uniao', 'niple', 'registro', 'valvula', 'rosca', 'soldavel', 'cpvc', 'pex', 'ppr', 'esgoto', 'agua fria', 'agua quente', ' gas' ),
		'pump' => array( 'motobomba', 'bomba periferica', 'bomba submersa', 'bomba', 'bombas', 'motor' ),
		'shower' => array( 'chuveiro', 'ducha eletrica' ),
		'tool' => array( 'ferramenta', 'abrasivo', 'disco de corte', 'serra copo' ),
	);

	public function resolve( \WC_Product $product ): array {
		$names = array(); $ids = array();
		$terms = wp_get_post_terms( $product->get_id(), 'product_cat' );
		if ( ! is_wp_error( $terms ) ) {
			foreach ( $terms as $term ) {
				$ids[] = absint( $term->term_id ); $line = array( $term->name );
				foreach ( array_reverse( get_ancestors( $term->term_id, 'product_cat', 'taxonomy' ) ) as $ancestor_id ) { $ancestor = get_term( $ancestor_id, 'product_cat' ); if ( $ancestor && ! is_wp_error( $ancestor ) ) { array_unshift( $line, $ancestor->name ); $ids[] = absint( $ancestor_id ); } }
				$names[] = implode( ' > ', array_unique( $line ) );
			}
		}
		$category = implode( ' / ', array_unique( $names ) );
		$category_plain = self::plain( $category ); $title_plain = self::plain( $product->get_name() );
		$family = $this->match( $category_plain ) ?: $this->match( $title_plain ) ?: 'generic';
		return array( 'family' => $family, 'family_label' => self::LABELS[ $family ], 'category' => $category, 'category_ids' => array_values( array_unique( $ids ) ) );
	}

	private function match( string $text ): string {
		foreach ( self::ALIASES as $family => $aliases ) { foreach ( $aliases as $alias ) { if ( false !== strpos( $text, self::plain( $alias ) ) ) { return $family; } } }
		return '';
	}

	private static function plain( string $value ): string { return strtolower( remove_accents( $value ) ); }
}
