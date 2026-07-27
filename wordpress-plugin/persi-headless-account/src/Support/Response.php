<?php

namespace Persi\HeadlessAccount\Support;

defined( 'ABSPATH' ) || exit;

final class Response {
	public static function json(
		array $data,
		int $status = 200,
		?int $retry_after = null
	): \WP_REST_Response {
		$response = new \WP_REST_Response( $data, $status );
		$response->header(
			'Cache-Control',
			'private, no-store, no-cache, max-age=0'
		);
		$response->header( 'Pragma', 'no-cache' );
		$response->header( 'Expires', '0' );
		$response->header( 'X-Content-Type-Options', 'nosniff' );
		$response->header( 'Referrer-Policy', 'no-referrer' );
		if ( null !== $retry_after && $retry_after > 0 ) {
			$response->header( 'Retry-After', (string) $retry_after );
		}
		return $response;
	}
}
