<?php
defined( 'ABSPATH' ) || exit;

final class Persi_Headless_Stock_Validator {
	public function validate( $raw_body, $origin ) {
		$data = json_decode( $raw_body, true );
		$keys = array( 'productId', 'variationId', 'email', 'website', 'consent', 'privacyPolicyVersion', 'privacyPolicyUrl' );
		if ( ! is_array( $data ) || array_diff( array_keys( $data ), $keys ) || array_diff( $keys, array_keys( $data ) ) ) return null;
		if ( ! is_int( $data['productId'] ) || $data['productId'] < 1 || ! is_int( $data['variationId'] ) || $data['variationId'] < 0 || ! is_string( $data['email'] ) || strlen( $data['email'] ) > 254 || ! is_string( $data['website'] ) || '' !== $data['website'] || true !== $data['consent'] || ! is_string( $data['privacyPolicyVersion'] ) || ! preg_match( '/^[A-Za-z0-9._-]{1,64}$/', $data['privacyPolicyVersion'] ) || ! is_string( $data['privacyPolicyUrl'] ) || strlen( $data['privacyPolicyUrl'] ) > 255 ) return null;
		$email = sanitize_email( $data['email'] );
		$policy = wp_parse_url( $data['privacyPolicyUrl'] );
		$policy_origin = is_array( $policy ) && isset( $policy['scheme'], $policy['host'] ) ? strtolower( $policy['scheme'] ) . '://' . strtolower( $policy['host'] ) . ( isset( $policy['port'] ) ? ':' . absint( $policy['port'] ) : '' ) : '';
		if ( ! is_email( $email ) || $policy_origin !== $origin || ( $policy['path'] ?? '' ) !== '/politica-de-privacidade-e-seguranca' || isset( $policy['query'] ) || isset( $policy['fragment'] ) || isset( $policy['user'] ) || isset( $policy['pass'] ) ) return null;
		$product = wc_get_product( $data['productId'] );
		$target = $data['variationId'] ? wc_get_product( $data['variationId'] ) : $product;
		if ( ! $product || 'publish' !== get_post_status( $data['productId'] ) || ! $target || $target->is_in_stock() || ( $data['variationId'] && (int) $target->get_parent_id() !== $data['productId'] ) ) return null;
		return array( 'product_id' => $data['productId'], 'variation_id' => $data['variationId'], 'email' => strtolower( $email ), 'policy_version' => $data['privacyPolicyVersion'], 'policy_url' => esc_url_raw( $data['privacyPolicyUrl'] ) );
	}
}
