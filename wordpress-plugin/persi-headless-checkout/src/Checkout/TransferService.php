<?php

namespace Persi\HeadlessCheckout\Checkout;

use Persi\HeadlessCheckout\Security\TransferToken;
use Persi\HeadlessCheckout\Support\Logger;

defined( 'ABSPATH' ) || exit;

final class TransferService {
	public const DEFAULT_TTL = 300;

	private $repository;
	private $token;
	private $logger;

	public function __construct(
		TransferRepository $repository,
		TransferToken $token,
		Logger $logger
	) {
		$this->repository = $repository;
		$this->token      = $token;
		$this->logger     = $logger;
	}

	public function create( array $payload, string $key_id, string $nonce, string $secret ): array {
		$encoded_payload = wp_json_encode( $payload, JSON_UNESCAPED_SLASHES );

		if ( false === $encoded_payload ) {
			$this->logger->error( 'payload_encoding_failed' );

			return array( 'status' => 'failed' );
		}

		$raw_token  = $this->token->generate();
		$created_at = time();
		$expires_at = $created_at + self::DEFAULT_TTL;
		$result     = $this->repository->create(
			array(
				'token_hash'        => $this->token->hash( $raw_token ),
				'request_nonce_hash' => hash_hmac( 'sha256', $nonce, $secret ),
				'payload_hash'      => hash( 'sha256', $encoded_payload ),
				'payload'           => $encoded_payload,
				'key_id'            => $key_id,
				'expires_at'        => gmdate( 'Y-m-d H:i:s', $expires_at ),
				'created_at'        => gmdate( 'Y-m-d H:i:s', $created_at ),
			)
		);

		if ( 'created' !== $result ) {
			$this->logger->warning( 'replay' === $result ? 'nonce_replay_rejected' : 'transfer_storage_failed' );

			return array( 'status' => $result );
		}

		$checkout_url = wc_get_checkout_url();

		return array(
			'status'       => 'created',
			'transfer_url' => add_query_arg( 'persi_checkout_transfer', $raw_token, $checkout_url ),
			'expires_at'   => gmdate( 'c', $expires_at ),
		);
	}
}
