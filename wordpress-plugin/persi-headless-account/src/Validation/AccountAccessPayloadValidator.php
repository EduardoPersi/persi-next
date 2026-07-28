<?php
namespace Persi\HeadlessAccount\Validation;
defined( 'ABSPATH' ) || exit;

final class AccountAccessPayloadValidator {
	private function decode( string $raw_body, array $allowed, ?array $required = null ): array {
		$value = json_decode( $raw_body, true );
		if ( ! is_array( $value ) || array_diff( array_keys( $value ), $allowed ) || array_diff( $required ?? $allowed, array_keys( $value ) ) ) {
			throw new ValidationException( 'invalid_payload' );
		}
		return $value;
	}

	public function register( string $raw_body ): array {
		$value = $this->decode(
			$raw_body,
			array( 'name', 'email', 'phone', 'cpf', 'password', 'passwordConfirmation', 'acceptTerms' ),
			array( 'name', 'email', 'password', 'passwordConfirmation', 'acceptTerms' )
		);
		$value['phone'] = $value['phone'] ?? '';
		$value['cpf'] = $value['cpf'] ?? '';
		$name = trim( (string) $value['name'] );
		$email = sanitize_email( (string) $value['email'] );
		if (
			mb_strlen( $name ) < 3 || ! is_email( $email ) ||
			! is_string( $value['password'] ) || strlen( $value['password'] ) < 8 ||
			$value['password'] !== $value['passwordConfirmation'] ||
			! is_string( $value['phone'] ) || mb_strlen( $value['phone'] ) > 30 ||
			! is_string( $value['cpf'] ) || mb_strlen( $value['cpf'] ) > 20 ||
			true !== $value['acceptTerms']
		) {
			throw new ValidationException( 'invalid_payload' );
		}
		return array( 'name' => $name, 'email' => $email, 'phone' => trim( $value['phone'] ), 'cpf' => trim( $value['cpf'] ), 'password' => $value['password'] );
	}

	public function forgot( string $raw_body ): string {
		$value = $this->decode( $raw_body, array( 'email' ) );
		$email = sanitize_email( (string) $value['email'] );
		if ( ! is_email( $email ) ) throw new ValidationException( 'invalid_payload' );
		return $email;
	}

	public function reset( string $raw_body ): array {
		$value = $this->decode( $raw_body, array( 'login', 'key', 'password', 'passwordConfirmation' ) );
		if ( ! is_string( $value['login'] ) || '' === trim( $value['login'] ) || ! is_string( $value['key'] ) || '' === trim( $value['key'] ) || ! is_string( $value['password'] ) || strlen( $value['password'] ) < 8 || $value['password'] !== $value['passwordConfirmation'] ) {
			throw new ValidationException( 'invalid_payload' );
		}
		return array( 'login' => trim( $value['login'] ), 'key' => trim( $value['key'] ), 'password' => $value['password'] );
	}
}
