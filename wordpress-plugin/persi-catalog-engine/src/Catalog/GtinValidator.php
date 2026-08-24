<?php

namespace Persi\CatalogEngine\Catalog;

defined( 'ABSPATH' ) || exit;

final class GtinValidator {
	public function normalize( $value ): string {
		return is_string( $value ) ? trim( $value ) : '';
	}

	public function is_valid( string $gtin ): bool {
		if ( ! preg_match( '/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/', $gtin ) ) {
			return false;
		}

		$sum    = 0;
		$length = strlen( $gtin );
		for ( $index = $length - 2, $position = 0; $index >= 0; --$index, ++$position ) {
			$sum += (int) $gtin[ $index ] * ( 0 === $position % 2 ? 3 : 1 );
		}

		return ( 10 - ( $sum % 10 ) ) % 10 === (int) $gtin[ $length - 1 ];
	}
}
