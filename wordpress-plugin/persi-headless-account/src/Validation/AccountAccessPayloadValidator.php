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
		if ( mb_strlen( $name ) < 3 || ! is_email( $email ) ) {
			throw new ValidationException( 'invalid_payload' );
		}
		if ( ! is_string( $value['phone'] ) || 1 !== preg_match( '/^[0-9\s()+.\-]*$/', $value['phone'] ) ) {
			throw new ValidationException( 'phone_invalid' );
		}
		$phone = preg_replace( '/\D+/', '', $value['phone'] );
		if ( '' !== $phone && ! in_array( strlen( $phone ), array( 10, 11 ), true ) ) {
			throw new ValidationException( 'phone_invalid' );
		}
		if ( ! is_string( $value['cpf'] ) || mb_strlen( $value['cpf'] ) > 20 ) {
			throw new ValidationException( 'cpf_invalid' );
		}
		if ( ! is_string( $value['password'] ) || strlen( $value['password'] ) < 8 ) {
			throw new ValidationException( 'password_invalid' );
		}
		if ( ! is_string( $value['passwordConfirmation'] ) || $value['password'] !== $value['passwordConfirmation'] ) {
			throw new ValidationException( 'password_mismatch' );
		}
		if ( true !== $value['acceptTerms'] ) {
			throw new ValidationException( 'terms_required' );
		}
		return array( 'name' => $name, 'email' => $email, 'phone' => $phone, 'cpf' => trim( $value['cpf'] ), 'password' => $value['password'] );
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

	public function login_guard( string $raw_body ): string {
		$value = $this->decode( $raw_body, array( 'identifier' ) );
		$identifier = trim( (string) $value['identifier'] );
		if ( '' === $identifier || mb_strlen( $identifier ) > 320 ) {
			throw new ValidationException( 'invalid_payload' );
		}
		return $identifier;
	}
}
