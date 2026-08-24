<?php

namespace Persi\CatalogEngine\Support;

defined( 'ABSPATH' ) || exit;

final class PayloadSanitizer {
	private const BLOCKED = array( 'access_token', 'refresh_token', 'client_secret', 'authorization', 'cookie', 'set-cookie', 'password', 'senha' );

	public function sanitize( $value, int $depth = 0 ) {
		if ( $depth > 12 ) {
			return '[profundidade limitada]';
		}
		if ( is_array( $value ) ) {
			$clean = array();
			foreach ( $value as $key => $item ) {
				$key_string = strtolower( preg_replace( '/[^a-z0-9]/i', '', (string) $key ) );
				$blocked = false;
				foreach ( self::BLOCKED as $blocked_key ) {
					if ( false !== strpos( $key_string, preg_replace( '/[^a-z0-9]/i', '', $blocked_key ) ) ) { $blocked = true; break; }
				}
				if ( $blocked ) {
					$clean[ $key ] = '[removido]';
					continue;
				}
				$clean[ $key ] = $this->sanitize( $item, $depth + 1 );
			}
			return $clean;
		}
		if ( is_object( $value ) ) {
			return $this->sanitize( get_object_vars( $value ), $depth + 1 );
		}
		if ( is_string( $value ) ) {
			return mb_substr( wp_strip_all_tags( $value ), 0, 5000 );
		}
		return is_scalar( $value ) || null === $value ? $value : '[tipo não exibido]';
	}

	public function paths( array $payload ): array {
		$paths = array();
		$this->walk_paths( $payload, '', $paths );
		sort( $paths );
		return array_values( array_unique( $paths ) );
	}

	private function walk_paths( array $value, string $prefix, array &$paths ): void {
		foreach ( $value as $key => $item ) {
			$segment = is_int( $key ) ? '[]' : (string) $key;
			$path    = '' === $prefix ? $segment : $prefix . ( '[]' === $segment ? '[]' : '.' . $segment );
			$paths[] = $path;
			if ( is_array( $item ) ) {
				$this->walk_paths( $item, $path, $paths );
			}
		}
	}
}
