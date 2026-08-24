<?php

namespace Persi\CatalogEngine\Attributes;

defined( 'ABSPATH' ) || exit;

final class DiscoveryRules {
	public const VERSION = '2.3.1';
	public const COLORS = array( 'branco acetinado' => 'Branco Acetinado', 'preto fosco' => 'Preto Fosco', 'rose gold' => 'Rose Gold', 'azul claro' => 'Azul Claro', 'azul escuro' => 'Azul Escuro', 'cinza grafite' => 'Cinza Grafite', 'branco gelo' => 'Branco Gelo', 'branco' => 'Branco', 'preto' => 'Preto', 'cinza' => 'Cinza', 'azul' => 'Azul', 'vermelho' => 'Vermelho', 'verde' => 'Verde', 'amarelo' => 'Amarelo', 'marrom' => 'Marrom', 'bege' => 'Bege', 'incolor' => 'Incolor', 'transparente' => 'Transparente', 'cristal' => 'Cristal', 'laranja' => 'Laranja', 'rosa' => 'Rosa', 'cromado' => 'Cromado', 'prata' => 'Prata', 'dourado' => 'Dourado' );
	public const COLOR_ALIASES = array( 'pto' => 'Preto', 'pto.' => 'Preto', 'br.' => 'Branco', 'cz' => 'Cinza', 'verm' => 'Vermelho' );
	public const FAMILY_CONCEPTS = array(
		'electrical_breaker' => array( 'corrente_nominal', 'numero_polos', 'tensao', 'fase', 'cor' ),
		'electrical_wire_cable' => array( 'secao_condutor', 'tensao', 'comprimento', 'cor' ),
		'electrical_switchgear' => array( 'corrente_nominal', 'numero_polos', 'tensao', 'potencia_aparente', 'fase', 'cor' ),
		'hydraulic_pipe' => array( 'bitola', 'comprimento', 'cor' ),
		'hydraulic_fitting' => array( 'rosca', 'bitola', 'medida_composta', 'cor' ),
		'pump' => array( 'potencia', 'tensao', 'corrente_nominal', 'fase', 'diametro', 'rosca' ),
		'shower' => array( 'potencia', 'tensao', 'cor' ),
		'tool' => array( 'diametro', 'potencia', 'tensao', 'cor' ),
		'generic' => array( 'cor' ),
	);

	public static function allows( string $family, string $concept ): bool {
		return in_array( $concept, self::FAMILY_CONCEPTS[ $family ] ?? array(), true );
	}
}
