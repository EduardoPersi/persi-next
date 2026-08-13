<?php

namespace Persi\HeadlessCheckout\Validation;

defined( 'ABSPATH' ) || exit;

final class TransferPayloadValidator {
	private const FORBIDDEN_FIELDS = array(
		'price',
		'subtotal',
		'discount',
		'shippingCost',
		'tax',
		'total',
		'stock',
		'currency',
	);

	public function validate_json( string $raw_body ): array {
		if ( '' === $raw_body || strlen( $raw_body ) > 32768 ) {
			throw new ValidationException( 'invalid_body_size' );
		}

		try {
			$payload = json_decode( $raw_body, true, 32, JSON_THROW_ON_ERROR );
		} catch ( \JsonException $exception ) {
			throw new ValidationException( 'invalid_json' );
		}

		if ( ! is_array( $payload ) || array_values( $payload ) === $payload ) {
			throw new ValidationException( 'invalid_payload' );
		}

		$this->reject_forbidden_fields( $payload );
		// billingAddress/shippingAddress são opcionais em conjunto: ausentes
		// quando a transferência parte direto do carrinho (sem passar pelas
		// etapas de Perfil/Endereço do Next.js) — o checkout nativo coleta
		// contato e endereço do zero nesse caso.
		$this->assert_keys_with_optional(
			$payload,
			array( 'items', 'couponCodes', 'shippingMethod', 'ownerToken' ),
			array( 'billingAddress', 'shippingAddress' )
		);

		$has_billing_address  = array_key_exists( 'billingAddress', $payload );
		$has_shipping_address = array_key_exists( 'shippingAddress', $payload );

		if ( $has_billing_address !== $has_shipping_address ) {
			throw new ValidationException( 'unknown_or_missing_property' );
		}

		// Sem entrada para 'billingAddress'/'shippingAddress' quando ausentes
		// (nunca null) — o payload validado é serializado e guardado, e
		// relido/revalidado por este mesmo método no consumo do token; uma
		// chave presente com valor null seria tratada como "endereço
		// inválido" na segunda passada, derrubando a transferência.
		$validated = array(
			'items'          => $this->validate_items( $payload['items'] ),
			'couponCodes'    => $this->validate_coupon_codes( $payload['couponCodes'] ),
			'shippingMethod' => $this->validate_shipping_method( $payload['shippingMethod'] ),
			'ownerToken'     => $this->validate_owner_token( $payload['ownerToken'] ),
		);

		if ( $has_billing_address ) {
			$validated['billingAddress']  = $this->validate_store_address( $payload['billingAddress'], true );
			$validated['shippingAddress'] = $this->validate_store_address( $payload['shippingAddress'], false );
		}

		return $validated;
	}

	// O Cart-Token é um JWT do WooCommerce Store API (opaco para este plugin) —
	// só precisa sobreviver íntegro até virar meta_data do pedido, para a
	// tela de confirmação no Next.js confirmar depois quem tem direito de ver
	// os detalhes (ver services/payments/statusAuthorization.ts).
	private function validate_owner_token( $owner_token ): string {
		if ( ! $this->required_string( $owner_token, 4096 ) ) {
			throw new ValidationException( 'invalid_owner_token' );
		}

		return $owner_token;
	}

	private function validate_items( $items ): array {
		if (
			! is_array( $items )
			|| array_values( $items ) !== $items
			|| count( $items ) < 1
			|| count( $items ) > 100
		) {
			throw new ValidationException( 'invalid_items' );
		}

		$validated = array();

		foreach ( $items as $item ) {
			if ( ! is_array( $item ) || array_values( $item ) === $item ) {
				throw new ValidationException( 'invalid_item' );
			}

			$this->reject_forbidden_fields( $item );
			$this->assert_exact_keys( $item, array( 'productId', 'variationId', 'quantity' ) );

			if ( ! is_int( $item['productId'] ) || $item['productId'] < 1 ) {
				throw new ValidationException( 'invalid_product_id' );
			}

			if ( ! is_int( $item['variationId'] ) || $item['variationId'] < 0 ) {
				throw new ValidationException( 'invalid_variation_id' );
			}

			if ( ! is_int( $item['quantity'] ) || $item['quantity'] < 1 || $item['quantity'] > 999 ) {
				throw new ValidationException( 'invalid_quantity' );
			}

			$validated[] = array(
				'productId'   => $item['productId'],
				'variationId' => $item['variationId'],
				'quantity'    => $item['quantity'],
			);
		}

		return $validated;
	}

	private function validate_coupon_codes( $coupon_codes ): array {
		if (
			! is_array( $coupon_codes )
			|| array_values( $coupon_codes ) !== $coupon_codes
			|| count( $coupon_codes ) > 20
		) {
			throw new ValidationException( 'invalid_coupon_codes' );
		}

		$validated = array();

		foreach ( $coupon_codes as $coupon_code ) {
			if ( ! is_string( $coupon_code ) || $this->string_length( $coupon_code ) > 100 ) {
				throw new ValidationException( 'invalid_coupon_code' );
			}

			$trimmed = trim( $coupon_code );

			if ( '' === $trimmed || preg_match( '/[\x00-\x1F\x7F]/', $trimmed ) ) {
				throw new ValidationException( 'invalid_coupon_code' );
			}

			$validated[] = $trimmed;
		}

		return $validated;
	}

	private function validate_shipping_method( $shipping_method ): array {
		if ( ! is_array( $shipping_method ) || array_values( $shipping_method ) === $shipping_method ) {
			throw new ValidationException( 'invalid_shipping_method' );
		}

		$this->reject_forbidden_fields( $shipping_method );
		$this->assert_exact_keys( $shipping_method, array( 'rateId', 'packageIndex' ) );

		if (
			! is_string( $shipping_method['rateId'] )
			|| $this->string_length( $shipping_method['rateId'] ) > 200
			|| preg_match( '/[\x00-\x1F\x7F]/', $shipping_method['rateId'] )
		) {
			throw new ValidationException( 'invalid_rate_id' );
		}

		if (
			! is_int( $shipping_method['packageIndex'] )
			|| $shipping_method['packageIndex'] < 0
			|| $shipping_method['packageIndex'] > 20
		) {
			throw new ValidationException( 'invalid_package_index' );
		}

		return array(
			'rateId'       => $shipping_method['rateId'],
			'packageIndex' => $shipping_method['packageIndex'],
		);
	}

	// address2/company são os únicos campos opcionais — endereço brasileiro
	// sem complemento é comum, e nem toda compra é para pessoa jurídica.
	// "require_contact" só é true para o endereço de cobrança: é de lá que
	// o CartRestorer tira e-mail/telefone para preencher WC()->customer,
	// o de entrega nunca carrega esses dois campos.
	private function validate_store_address( $address, bool $require_contact ): array {
		if ( ! is_array( $address ) || array_values( $address ) === $address ) {
			throw new ValidationException( 'invalid_address' );
		}

		$this->reject_forbidden_fields( $address );

		$allowed_keys = array( 'firstName', 'lastName', 'company', 'address1', 'address2', 'city', 'state', 'postcode', 'country' );
		if ( $require_contact ) {
			$allowed_keys[] = 'email';
			$allowed_keys[] = 'phone';
		}

		$actual_keys = array_keys( $address );
		$optional_keys = array( 'company', 'address2' );
		$missing_required = array_diff( array_diff( $allowed_keys, $optional_keys ), $actual_keys );
		$unknown = array_diff( $actual_keys, $allowed_keys );

		if ( ! empty( $missing_required ) || ! empty( $unknown ) ) {
			throw new ValidationException( 'unknown_or_missing_property' );
		}

		if ( ! $this->required_string( $address['firstName'] ?? null, 100 ) ) {
			throw new ValidationException( 'invalid_address_first_name' );
		}
		if ( ! $this->required_string( $address['lastName'] ?? null, 100 ) ) {
			throw new ValidationException( 'invalid_address_last_name' );
		}
		if ( array_key_exists( 'company', $address ) && ! $this->optional_string( $address['company'], 200 ) ) {
			throw new ValidationException( 'invalid_address_company' );
		}
		if ( ! $this->required_string( $address['address1'] ?? null, 200 ) ) {
			throw new ValidationException( 'invalid_address_line1' );
		}
		if ( array_key_exists( 'address2', $address ) && ! $this->optional_string( $address['address2'], 200 ) ) {
			throw new ValidationException( 'invalid_address_line2' );
		}
		if ( ! $this->required_string( $address['city'] ?? null, 100 ) ) {
			throw new ValidationException( 'invalid_address_city' );
		}
		if ( ! is_string( $address['state'] ?? null ) || ! preg_match( '/^[A-Z]{2}$/', $address['state'] ) ) {
			throw new ValidationException( 'invalid_address_state' );
		}
		if ( ! is_string( $address['postcode'] ?? null ) || ! preg_match( '/^\d{8}$/', $address['postcode'] ) ) {
			throw new ValidationException( 'invalid_address_postcode' );
		}
		if ( 'BR' !== ( $address['country'] ?? null ) ) {
			throw new ValidationException( 'invalid_address_country' );
		}

		$validated = array(
			'firstName' => trim( $address['firstName'] ),
			'lastName'  => trim( $address['lastName'] ),
			'address1'  => trim( $address['address1'] ),
			'city'      => trim( $address['city'] ),
			'state'     => $address['state'],
			'postcode'  => $address['postcode'],
			'country'   => 'BR',
		);

		if ( array_key_exists( 'company', $address ) && '' !== trim( (string) $address['company'] ) ) {
			$validated['company'] = trim( $address['company'] );
		}
		if ( array_key_exists( 'address2', $address ) && '' !== trim( (string) $address['address2'] ) ) {
			$validated['address2'] = trim( $address['address2'] );
		}

		if ( $require_contact ) {
			if ( ! is_string( $address['email'] ?? null ) || ! is_email( $address['email'] ) ) {
				throw new ValidationException( 'invalid_address_email' );
			}
			if ( ! is_string( $address['phone'] ?? null ) || ! preg_match( '/^\d{10,11}$/', $address['phone'] ) ) {
				throw new ValidationException( 'invalid_address_phone' );
			}

			$validated['email'] = sanitize_email( $address['email'] );
			$validated['phone'] = $address['phone'];
		}

		return $validated;
	}

	private function required_string( $value, int $max_length ): bool {
		return is_string( $value )
			&& '' !== trim( $value )
			&& $this->string_length( $value ) <= $max_length
			&& ! preg_match( '/[\x00-\x1F\x7F]/', $value );
	}

	private function optional_string( $value, int $max_length ): bool {
		return is_string( $value )
			&& $this->string_length( $value ) <= $max_length
			&& ! preg_match( '/[\x00-\x1F\x7F]/', $value );
	}

	private function assert_exact_keys( array $value, array $allowed_keys ): void {
		$actual_keys = array_keys( $value );
		sort( $actual_keys );
		sort( $allowed_keys );

		if ( $actual_keys !== $allowed_keys ) {
			throw new ValidationException( 'unknown_or_missing_property' );
		}
	}

	private function assert_keys_with_optional( array $value, array $required_keys, array $optional_keys ): void {
		$actual_keys  = array_keys( $value );
		$allowed_keys = array_merge( $required_keys, $optional_keys );
		$missing      = array_diff( $required_keys, $actual_keys );
		$unknown      = array_diff( $actual_keys, $allowed_keys );

		if ( ! empty( $missing ) || ! empty( $unknown ) ) {
			throw new ValidationException( 'unknown_or_missing_property' );
		}
	}

	private function reject_forbidden_fields( array $value ): void {
		foreach ( self::FORBIDDEN_FIELDS as $field ) {
			if ( array_key_exists( $field, $value ) ) {
				throw new ValidationException( 'forbidden_commercial_field' );
			}
		}
	}

	private function string_length( string $value ): int {
		return function_exists( 'mb_strlen' ) ? mb_strlen( $value, 'UTF-8' ) : strlen( $value );
	}
}
