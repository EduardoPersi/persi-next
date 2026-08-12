<?php

namespace Persi\HeadlessCheckout\Checkout;

use Persi\HeadlessCheckout\Support\Configuration;
use Persi\HeadlessCheckout\Support\Logger;
use Persi\HeadlessCheckout\Validation\TransferPayloadValidator;
use Persi\HeadlessCheckout\Validation\ValidationException;

defined( 'ABSPATH' ) || exit;

final class CheckoutRedirect {
	private const TOKEN_PARAMETER = 'persi_checkout_transfer';

	private $repository;
	private $validator;
	private $cart_restorer;
	private $logger;
	private $configuration;

	public function __construct(
		TransferRepository $repository,
		TransferPayloadValidator $validator,
		CartRestorer $cart_restorer,
		Logger $logger,
		Configuration $configuration
	) {
		$this->repository    = $repository;
		$this->validator     = $validator;
		$this->cart_restorer = $cart_restorer;
		$this->logger        = $logger;
		$this->configuration = $configuration;
	}

	public function register(): void {
		add_action( 'template_redirect', array( $this, 'maybe_consume_transfer' ), 1 );
	}

	public function maybe_consume_transfer(): void {
		$token = isset( $_GET[ self::TOKEN_PARAMETER ] )
			? wp_unslash( $_GET[ self::TOKEN_PARAMETER ] )
			: null;

		if (
			! self::should_handle_request(
				function_exists( 'is_checkout' ) && is_checkout(),
				function_exists( 'is_wc_endpoint_url' ) && is_wc_endpoint_url(),
				is_admin(),
				wp_doing_ajax(),
				defined( 'REST_REQUEST' ) && REST_REQUEST,
				$token
			)
		) {
			return;
		}

		$this->send_private_headers();

		if ( ! is_string( $token ) || ! self::is_valid_token_format( $token ) ) {
			$this->fail_without_record( 'malformed_token' );
		}

		$record = $this->repository->find_by_token_hash( hash( 'sha256', $token ) );

		if ( null === $record ) {
			$this->fail_without_record( 'token_not_found' );
		}

		$now      = gmdate( 'Y-m-d H:i:s' );
		$record_id = (int) $record['id'];

		if ( 'pending' !== $record['status'] ) {
			$this->fail_without_record( 'token_unavailable' );
		}

		if ( $this->is_expired( $record['expires_at'], $now ) ) {
			$this->repository->mark_expired( $record_id, $now );
			$this->fail_without_record( 'token_expired' );
		}

		if (
			! self::has_valid_payload_hash(
				$record['payload'] ?? null,
				$record['payload_hash'] ?? null
			)
		) {
			$this->repository->mark_pending_failed( $record_id, 'payload_integrity_failed', $now );
			$this->fail_without_record( 'payload_integrity_failed' );
		}

		try {
			$payload = $this->validator->validate_json( $record['payload'] );
		} catch ( ValidationException $exception ) {
			$this->repository->mark_pending_failed( $record_id, 'payload_invalid', $now );
			$this->fail_without_record( 'payload_invalid' );
		}

		if ( ! $this->repository->acquire( $record_id, $now ) ) {
			$this->fail_without_record( 'concurrent_consumption' );
		}

		$snapshot        = array();
		$cart_was_cleared = false;

		try {
			$this->cart_restorer->initialize_woocommerce();
			$validated_items = $this->cart_restorer->prevalidate( $payload['items'] );
			$snapshot        = $this->cart_restorer->snapshot_current_cart();
			$cart_was_cleared = true;
			$this->cart_restorer->restore_validated_items(
				$validated_items,
				$payload['billingAddress'],
				$payload['shippingAddress']
			);

			$used_at = gmdate( 'Y-m-d H:i:s' );

			if ( ! $this->repository->mark_used( $record_id, $used_at ) ) {
				throw new CartRestoreException( 'state_update_failed' );
			}
		} catch ( CartRestoreException $exception ) {
			$failure_code = $this->safe_failure_code( $exception->get_failure_code() );

			if ( $cart_was_cleared && ! $this->cart_restorer->recover_snapshot( $snapshot ) ) {
				$this->logger->error( 'snapshot_recovery_failed' );
				$failure_code = 'snapshot_recovery_failed';
			}

			$this->repository->mark_processing_failed( $record_id, $failure_code, gmdate( 'Y-m-d H:i:s' ) );
			$this->fail_without_record( $failure_code );
		} catch ( \Throwable $exception ) {
			if ( $cart_was_cleared && ! $this->cart_restorer->recover_snapshot( $snapshot ) ) {
				$this->logger->error( 'snapshot_recovery_failed' );
			}

			$this->repository->mark_processing_failed( $record_id, 'internal_error', gmdate( 'Y-m-d H:i:s' ) );
			$this->fail_without_record( 'internal_error' );
		}

		$checkout_url = self::checkout_url_without_token( wc_get_checkout_url() );

		wp_safe_redirect( $checkout_url, 303, 'Persi Headless Checkout' );
		exit;
	}

	public static function should_handle_request(
		bool $is_checkout,
		bool $is_checkout_endpoint,
		bool $is_admin,
		bool $is_ajax,
		bool $is_rest,
		$token
	): bool {
		return $is_checkout
			&& ! $is_checkout_endpoint
			&& ! $is_admin
			&& ! $is_ajax
			&& ! $is_rest
			&& null !== $token;
	}

	public static function is_valid_token_format( string $token ): bool {
		return 1 === preg_match( '/^[A-Za-z0-9_-]{43}$/', $token );
	}

	public static function checkout_url_without_token( string $checkout_url ): string {
		return remove_query_arg( self::TOKEN_PARAMETER, $checkout_url );
	}

	public static function has_valid_payload_hash( $payload, $payload_hash ): bool {
		return is_string( $payload )
			&& is_string( $payload_hash )
			&& 64 === strlen( $payload_hash )
			&& hash_equals( $payload_hash, hash( 'sha256', $payload ) );
	}

	private function is_expired( string $expires_at, string $current_time ): bool {
		$expiration_timestamp = strtotime( $expires_at . ' UTC' );
		$current_timestamp    = strtotime( $current_time . ' UTC' );

		return false === $expiration_timestamp
			|| false === $current_timestamp
			|| $expiration_timestamp <= $current_timestamp;
	}

	private function fail_without_record( string $failure_code ): void {
		$this->logger->warning( 'token_consumption_failed' );
		$this->render_failure_page();
	}

	private function render_failure_page(): void {
		$this->send_private_headers();

		$message  = '<p>';
		$message .= esc_html__( 'Não foi possível recuperar este carrinho. O link pode ter expirado ou já ter sido utilizado.', 'persi-headless-checkout' );
		$message .= '</p>';
		$cart_url = $this->configuration->cart_url();

		if ( '' !== $cart_url ) {
			$message .= sprintf(
				'<p><a href="%s">%s</a></p>',
				esc_url( $cart_url ),
				esc_html__( 'Voltar ao carrinho', 'persi-headless-checkout' )
			);
		}

		wp_die(
			wp_kses_post( $message ),
			esc_html__( 'Não foi possível recuperar o carrinho', 'persi-headless-checkout' ),
			array( 'response' => 400 )
		);
		exit;
	}

	private function send_private_headers(): void {
		if ( headers_sent() ) {
			return;
		}

		header( 'Cache-Control: private, no-store, no-cache, max-age=0' );
		header( 'Pragma: no-cache' );
		header( 'Expires: 0' );
		header( 'Referrer-Policy: no-referrer' );
		header( 'X-Content-Type-Options: nosniff' );
	}

	private function safe_failure_code( string $failure_code ): string {
		$allowed_codes = array(
			'woocommerce_unavailable',
			'cart_initialization_failed',
			'invalid_item',
			'duplicate_item',
			'product_not_found',
			'product_not_published',
			'unsupported_product_type',
			'product_requires_cart_item_data',
			'product_not_purchasable',
			'sold_individually',
			'maximum_quantity_exceeded',
			'insufficient_stock',
			'variation_parent_invalid',
			'variation_not_found',
			'variation_parent_mismatch',
			'variation_invalid',
			'cart_add_failed',
			'cart_restore_failed',
			'state_update_failed',
			'snapshot_recovery_failed',
		);

		return in_array( $failure_code, $allowed_codes, true ) ? $failure_code : 'internal_error';
	}
}
