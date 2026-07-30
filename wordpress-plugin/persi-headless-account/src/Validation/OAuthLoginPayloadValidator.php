<?php

namespace Persi\HeadlessAccount\Validation;

defined( 'ABSPATH' ) || exit;

final class OAuthLoginPayloadValidator {
	private const PROVIDERS = array( 'google', 'facebook' );

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

		$allowed = array(
			'avatar',
			'email',
			'name',
			'provider',
			'providerId',
			'verifiedEmail',
		);
		if (
			array_diff( array_keys( $value ), $allowed ) ||
			array_diff( $allowed, array_keys( $value ) )
		) {
			throw new ValidationException( 'unknown_or_missing_property' );
		}

		$provider = is_string( $value['provider'] )
			? strtolower( trim( $value['provider'] ) )
			: '';
		if (
			! in_array( $provider, self::PROVIDERS, true ) ||
			true !== $value['verifiedEmail'] ||
			! is_string( $value['providerId'] ) ||
			1 !== preg_match( '/^[A-Za-z0-9._-]{1,255}$/', $value['providerId'] ) ||
			! is_string( $value['email'] ) ||
			! is_email( $value['email'] )
		) {
			throw new ValidationException( 'invalid_identity' );
		}

		foreach ( array( 'name' => 200, 'avatar' => 2048 ) as $field => $limit ) {
			if (
				! is_string( $value[ $field ] ) ||
				$this->length( $value[ $field ] ) > $limit
			) {
				throw new ValidationException( 'invalid_profile' );
			}
		}

		$avatar = trim( $value['avatar'] );
		if ( '' !== $avatar ) {
			$parts = wp_parse_url( $avatar );
			if (
				! is_array( $parts ) ||
				'https' !== strtolower( (string) ( $parts['scheme'] ?? '' ) )
			) {
				throw new ValidationException( 'invalid_avatar' );
			}
		}

		$name = trim( $value['name'] );
		return array(
			'provider'       => $provider,
			'provider_id'    => $value['providerId'],
			'email'          => strtolower( sanitize_email( $value['email'] ) ),
			'verified_email' => true,
			'name'           => $name,
			'avatar'         => $avatar,
			'first_name'     => $this->first_name( $name ),
			'last_name'      => $this->last_name( $name ),
		);
	}

	private function first_name( string $name ): string {
		$parts = preg_split( '/\s+/', trim( $name ), 2 );
		return is_array( $parts ) ? (string) ( $parts[0] ?? '' ) : '';
	}

	private function last_name( string $name ): string {
		$parts = preg_split( '/\s+/', trim( $name ), 2 );
		return is_array( $parts ) ? (string) ( $parts[1] ?? '' ) : '';
	}

	private function length( string $value ): int {
		return function_exists( 'mb_strlen' )
			? mb_strlen( $value, 'UTF-8' )
			: strlen( $value );
	}
}
