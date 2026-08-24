<?php

namespace Persi\CatalogEngine\Attributes;

defined( 'ABSPATH' ) || exit;

final class ValueNormalizer {
	public static function measurement( string $raw, string $unit ): string {
		$value = trim( preg_replace( '/\s+/u', ' ', $raw ) );
		if ( 0 === strcasecmp( $value, 'bivolt' ) ) { return 'Bivolt'; }
		if ( 'in' === $unit ) { return preg_replace( '/\s*(?:"|pol(?:egadas?)?)$/iu', '"', $value ); }
		$number = preg_replace( '/[^0-9,.\/ ]/', '', $value );
		$number = trim( str_replace( '.', ',', $number ) );
		$labels = array( 'a' => 'A', 'v' => 'V', 'w' => 'W', 'mm' => 'mm', 'm' => 'm', 'ka' => 'kA', 'k' => 'K', 'cv' => 'CV' );
		return trim( $number . ' ' . ( $labels[ strtolower( $unit ) ] ?? $unit ) );
	}
}
