<?php

namespace Persi\HeadlessCheckout\Checkout;

defined( 'ABSPATH' ) || exit;

final class TransferRepository {
	private $database;
	private $table_name;

	public function __construct( $database ) {
		$this->database   = $database;
		$this->table_name = $database->prefix . 'persi_checkout_transfers';
	}

	public function create( array $record ): string {
		$inserted = $this->database->insert(
			$this->table_name,
			array(
				'token_hash'        => $record['token_hash'],
				'request_nonce_hash' => $record['request_nonce_hash'],
				'payload_hash'      => $record['payload_hash'],
				'payload'           => $record['payload'],
				'key_id'            => $record['key_id'],
				'status'            => 'pending',
				'expires_at'        => $record['expires_at'],
				'created_at'        => $record['created_at'],
				'updated_at'        => $record['created_at'],
				'attempts'          => 0,
			),
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%d' )
		);

		if ( false !== $inserted ) {
			return 'created';
		}

		$existing_nonce = $this->database->get_var(
			$this->database->prepare(
				"SELECT id FROM {$this->table_name} WHERE request_nonce_hash = %s LIMIT 1",
				$record['request_nonce_hash']
			)
		);

		return null !== $existing_nonce ? 'replay' : 'failed';
	}

	public function find_by_token_hash( string $token_hash ): ?array {
		$record = $this->database->get_row(
			$this->database->prepare(
				"SELECT id, token_hash, payload_hash, payload, status, expires_at
				FROM {$this->table_name}
				WHERE token_hash = %s
				LIMIT 1",
				$token_hash
			),
			ARRAY_A
		);

		return is_array( $record ) ? $record : null;
	}

	public function acquire( int $transfer_id, string $current_time ): bool {
		$affected = $this->database->query(
			$this->database->prepare(
				"UPDATE {$this->table_name}
				SET status = 'processing',
					attempts = attempts + 1,
					updated_at = %s
				WHERE id = %d
					AND status = 'pending'
					AND expires_at > %s",
				$current_time,
				$transfer_id,
				$current_time
			)
		);

		return 1 === $affected;
	}

	public function mark_expired( int $transfer_id, string $current_time ): bool {
		$affected = $this->database->query(
			$this->database->prepare(
				"UPDATE {$this->table_name}
				SET status = 'expired',
					failure_code = 'token_expired',
					updated_at = %s
				WHERE id = %d
					AND status = 'pending'
					AND expires_at <= %s",
				$current_time,
				$transfer_id,
				$current_time
			)
		);

		return 1 === $affected;
	}

	public function mark_pending_failed( int $transfer_id, string $failure_code, string $current_time ): bool {
		return $this->transition_to_failed( $transfer_id, 'pending', $failure_code, $current_time );
	}

	public function mark_processing_failed( int $transfer_id, string $failure_code, string $current_time ): bool {
		return $this->transition_to_failed( $transfer_id, 'processing', $failure_code, $current_time );
	}

	public function mark_used( int $transfer_id, string $current_time ): bool {
		$affected = $this->database->query(
			$this->database->prepare(
				"UPDATE {$this->table_name}
				SET status = 'used',
					used_at = %s,
					updated_at = %s,
					failure_code = NULL
				WHERE id = %d
					AND status = 'processing'",
				$current_time,
				$current_time,
				$transfer_id
			)
		);

		return 1 === $affected;
	}

	private function transition_to_failed(
		int $transfer_id,
		string $expected_status,
		string $failure_code,
		string $current_time
	): bool {
		$affected = $this->database->query(
			$this->database->prepare(
				"UPDATE {$this->table_name}
				SET status = 'failed',
					failure_code = %s,
					updated_at = %s
				WHERE id = %d
					AND status = %s",
				$failure_code,
				$current_time,
				$transfer_id,
				$expected_status
			)
		);

		return 1 === $affected;
	}
}
