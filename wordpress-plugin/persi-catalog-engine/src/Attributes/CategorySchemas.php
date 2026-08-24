<?php

namespace Persi\CatalogEngine\Attributes;

defined( 'ABSPATH' ) || exit;

final class CategorySchemas {
	private const SCHEMAS = array(
		'disjuntores' => array( 'keywords' => array( 'disjuntor' ), 'attributes' => array( 'corrente_nominal', 'numero_polos', 'curva', 'capacidade_interrupcao', 'tensao' ) ),
		'tubos' => array( 'keywords' => array( 'tubo', 'cano' ), 'attributes' => array( 'bitola', 'comprimento', 'material' ) ),
		'conexoes' => array( 'keywords' => array( 'conexao', 'conexões', 'joelho', 'uniao', 'união', 'luva', 'adaptador' ), 'attributes' => array( 'bitola', 'material' ) ),
		'lampadas' => array( 'keywords' => array( 'lampada', 'lâmpada', 'led' ), 'attributes' => array( 'potencia', 'tensao', 'temperatura_cor', 'base' ) ),
		'bombas' => array( 'keywords' => array( 'bomba', 'motobomba' ), 'attributes' => array( 'potencia_mecanica', 'tensao', 'diametro' ) ),
	);

	public static function resolve( string $context ): array {
		$plain = strtolower( remove_accents( $context ) );
		foreach ( self::SCHEMAS as $family => $schema ) {
			foreach ( $schema['keywords'] as $keyword ) {
				if ( false !== strpos( $plain, strtolower( remove_accents( $keyword ) ) ) ) { return array( 'family' => $family, 'attributes' => $schema['attributes'] ); }
			}
		}
		return array( 'family' => '', 'attributes' => array() );
	}
}
