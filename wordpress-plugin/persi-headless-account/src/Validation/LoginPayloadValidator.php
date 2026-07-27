<?php

namespace Persi\HeadlessAccount\Validation;

defined( 'ABSPATH' ) || exit;

final class LoginPayloadValidator {
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
		sort( $keys );
		if ( array( 'identifier', 'password', 'remember' ) !== $keys ) {
			throw new ValidationException( 'unknown_or_missing_property' );
		}

		if (
			! is_string( $value['identifier'] ) ||
			! is_string( $value['password'] ) ||
			! is_bool( $value['remember'] )
		) {
			throw new ValidationException( 'invalid_field_type' );
		}

		$identifier = trim( $value['identifier'] );
		$password   = $value['password'];
		if (
			'' === $identifier ||
			$this->length( $identifier ) > 254 ||
			'' === $password ||
			$this->length( $password ) > 4096 ||
			preg_match( '/[\x00-\x1F\x7F]/', $identifier )
		) {
			throw new ValidationException( 'invalid_field_value' );
		}

		return array(
			'identifier' => $identifier,
			'password'   => $password,
			'remember'   => $value['remember'],
		);
	}

	private function length( string $value ): int {
		return function_exists( 'mb_strlen' )
			? mb_strlen( $value, 'UTF-8' )
			: strlen( $value );
	}
}
