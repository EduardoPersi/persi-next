<?php

namespace Persi\HeadlessAccount\Support;

defined( 'ABSPATH' ) || exit;

final class OriginNormalizer {
	public static function normalize( $origin ): string {
		if ( ! is_string( $origin ) ) {
			return '';
		}

		$parts = parse_url( trim( $origin ) );
		if (
			false === $parts ||
			! isset( $parts['scheme'], $parts['host'] ) ||
			! in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true ) ||
			isset( $parts['user'] ) ||
			isset( $parts['pass'] ) ||
			isset( $parts['query'] ) ||
			isset( $parts['fragment'] ) ||
			( isset( $parts['path'] ) && ! in_array( $parts['path'], array( '', '/' ), true ) )
		) {
			return '';
		}

		$result = strtolower( $parts['scheme'] ) . '://' . strtolower( $parts['host'] );
		if ( isset( $parts['port'] ) ) {
			$result .= ':' . (int) $parts['port'];
		}
		return $result;
	}
}
