<?php

namespace Persi\CatalogEngine\Attributes;

defined( 'ABSPATH' ) || exit;

final class CanonicalDictionary {
	private const ITEMS = array(
		'corrente_nominal' => array( 'taxonomy' => 'pa_corrente', 'aliases' => array( 'amperagem', 'ampere', 'amperes', 'corrente', 'corrente eletrica', 'corrente nominal' ) ),
		'potencia' => array( 'taxonomy' => 'pa_potencia', 'aliases' => array( 'potencia', 'potencia eletrica' ) ),
		'potencia_aparente' => array( 'taxonomy' => '', 'aliases' => array( 'potencia aparente', 'va', 'kva' ) ),
		'tensao' => array( 'taxonomy' => 'pa_tensao', 'aliases' => array( 'voltagem', 'tensao', 'tensao eletrica', 'tensao nominal' ) ),
		'bitola' => array( 'taxonomy' => 'pa_bitola', 'aliases' => array( 'bitola', 'diametro nominal' ) ),
		'medida_composta' => array( 'taxonomy' => 'pa_medida', 'aliases' => array( 'medida', 'medida composta', 'medida comercial' ) ),
		'secao_condutor' => array( 'taxonomy' => '', 'aliases' => array( 'secao nominal', 'secao do condutor', 'bitola do cabo' ) ),
		'fase' => array( 'taxonomy' => 'pa_fase', 'aliases' => array( 'fase', 'numero de fases' ) ),
		'comprimento' => array( 'taxonomy' => 'pa_comprimento', 'aliases' => array( 'comprimento' ) ),
		'diametro' => array( 'taxonomy' => 'pa_diametro', 'aliases' => array( 'diametro' ) ),
		'rosca' => array( 'taxonomy' => 'pa_bitola', 'aliases' => array( 'rosca', 'medida da rosca' ) ),
		'material' => array( 'taxonomy' => 'pa_material', 'aliases' => array( 'material' ) ),
		'cor' => array( 'taxonomy' => 'pa_cor', 'aliases' => array( 'cor' ) ),
		'numero_polos' => array( 'taxonomy' => 'pa_polos', 'aliases' => array( 'polos', 'numero de polos' ) ),
		'curva' => array( 'taxonomy' => 'pa_curva', 'aliases' => array( 'curva' ) ),
		'capacidade_interrupcao' => array( 'taxonomy' => 'pa_capacidade-interrupcao', 'aliases' => array( 'capacidade de interrupcao', 'capacidade interrupcao' ) ),
		'temperatura_cor' => array( 'taxonomy' => 'pa_temperatura-cor', 'aliases' => array( 'temperatura de cor' ) ),
		'base' => array( 'taxonomy' => 'pa_base', 'aliases' => array( 'base', 'soquete' ) ),
		'marca' => array( 'taxonomy' => 'product_brand', 'aliases' => array( 'marca', 'fabricante' ) ),
	);

	public static function taxonomy( string $key ): string { return self::ITEMS[ $key ]['taxonomy'] ?? ''; }
	public static function suggest_key( string $label ): string {
		$needle = self::plain( $label );
		foreach ( self::ITEMS as $key => $item ) {
			if ( in_array( $needle, $item['aliases'], true ) || $needle === str_replace( '_', ' ', $key ) ) { return $key; }
		}
		return '';
	}
	public static function label( string $key ): string { return ucwords( str_replace( '_', ' ', $key ) ); }
	private static function plain( string $value ): string { return strtolower( remove_accents( trim( $value ) ) ); }
}
