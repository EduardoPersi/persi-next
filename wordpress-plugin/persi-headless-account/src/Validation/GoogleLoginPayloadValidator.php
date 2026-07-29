<?php

namespace Persi\HeadlessAccount\Validation;

defined( 'ABSPATH' ) || exit;

final class GoogleLoginPayloadValidator {
	public function validate( string $raw_body ): array {
		if ( '' === $raw_body || strlen( $raw_body ) > 8192 ) {
			throw new ValidationException( 'invalid_body' );
		}

		try {
			$value = json_decode( $raw_body, true, 8, JSON_THROW_ON_ERROR );
		} catch ( \JsonException $exception ) {
			throw new ValidationException( 'invalid_json' );
		}
		if ( ! is_array( $value ) || array_values( $value ) === $value ) {
			throw new ValidationException( 'invalid_payload' );
		}

		$keys = array_keys( $value );
		$allowed = array(
			'displayName',
			'email',
			'emailVerified',
			'firstName',
			'lastName',
			'picture',
			'provider',
			'subject',
		);
		$required = array_diff( $allowed, array( 'picture' ) );
		if (
			array_diff( $keys, $allowed ) ||
			array_diff( $required, $keys )
		) {
			throw new ValidationException( 'unknown_or_missing_property' );
		}
		$value['picture'] = $value['picture'] ?? '';
		if (
			'google' !== $value['provider'] ||
			true !== $value['emailVerified'] ||
			! is_string( $value['subject'] ) ||
			1 !== preg_match( '/^[A-Za-z0-9_-]{1,255}$/', $value['subject'] ) ||
			! is_string( $value['email'] ) ||
			! is_email( $value['email'] )
		) {
			throw new ValidationException( 'invalid_identity' );
		}

		foreach ( array( 'firstName' => 100, 'lastName' => 100, 'displayName' => 200, 'picture' => 2048 ) as $field => $limit ) {
			if ( ! is_string( $value[ $field ] ) || $this->length( $value[ $field ] ) > $limit ) {
				throw new ValidationException( 'invalid_profile' );
			}
		}
		$picture = trim( $value['picture'] );
		if ( '' !== $picture ) {
			$parts = wp_parse_url( $picture );
			if ( ! is_array( $parts ) || 'https' !== strtolower( (string) ( $parts['scheme'] ?? '' ) ) ) {
				throw new ValidationException( 'invalid_picture' );
			}
		}

		return array(
			'provider'       => 'google',
			'subject'        => $value['subject'],
			'email'          => strtolower( sanitize_email( $value['email'] ) ),
			'email_verified' => true,
			'first_name'     => trim( $value['firstName'] ),
			'last_name'      => trim( $value['lastName'] ),
			'display_name'   => trim( $value['displayName'] ),
			'picture'        => $picture,
		);
	}

	private function length( string $value ): int {
		return function_exists( 'mb_strlen' )
			? mb_strlen( $value, 'UTF-8' )
			: strlen( $value );
	}
}
