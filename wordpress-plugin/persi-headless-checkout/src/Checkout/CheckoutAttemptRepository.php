<?php

namespace Persi\HeadlessCheckout\Checkout;

defined( 'ABSPATH' ) || exit;

final class CheckoutAttemptRepository {
	private const LEASE_SECONDS = 90;
	private $wpdb;
	private $table;

	public function __construct( $wpdb ) {
		$this->wpdb  = $wpdb;
		$this->table = $wpdb->prefix . 'persi_checkout_attempts';
	}

	public function reserve( string $attempt_id, string $provider, string $method ): array {
		$now   = gmdate( 'Y-m-d H:i:s' );
		$lease = bin2hex( random_bytes( 32 ) );
		$sql   = $this->wpdb->prepare(
			"INSERT IGNORE INTO {$this->table} (checkout_attempt_id, payment_provider, payment_method, state, lease_hash, lease_expires_at, created_at, updated_at) VALUES (%s, %s, %s, 'RESERVED', %s, %s, %s, %s)",
			$attempt_id,
			$provider,
			$method,
			hash( 'sha256', $lease ),
			gmdate( 'Y-m-d H:i:s', time() + self::LEASE_SECONDS ),
			$now,
			$now
		);
		$inserted = 1 === (int) $this->wpdb->query( $sql );
		if ( ! $inserted ) {
			$takeover = $this->wpdb->prepare(
				"UPDATE {$this->table} SET lease_hash = %s, lease_expires_at = %s, updated_at = %s WHERE checkout_attempt_id = %s AND state IN ('RESERVED', 'ORDER_CREATED', 'PAYMENT_CREATING') AND lease_expires_at < %s",
				hash( 'sha256', $lease ),
				gmdate( 'Y-m-d H:i:s', time() + self::LEASE_SECONDS ),
				$now,
				$attempt_id,
				$now
			);
			$inserted = 1 === (int) $this->wpdb->query( $takeover );
		}
		$row      = $this->find( $attempt_id );

		return array( 'attempt' => $row, 'acquired' => $inserted, 'lease_token' => $inserted ? $lease : null );
	}

	public function find( string $attempt_id ): ?array {
		$row = $this->wpdb->get_row(
			$this->wpdb->prepare( "SELECT checkout_attempt_id, order_id, payment_provider, payment_method, provider_reference, state, updated_at FROM {$this->table} WHERE checkout_attempt_id = %s LIMIT 1", $attempt_id ),
			ARRAY_A
		);
		return is_array( $row ) ? $row : null;
	}

	public function health(): array {
		$table_exists = $this->table === $this->wpdb->get_var(
			$this->wpdb->prepare( 'SHOW TABLES LIKE %s', $this->wpdb->esc_like( $this->table ) )
		);
		$unique_exists = false;
		if ( $table_exists ) {
			$indexes = $this->wpdb->get_results( "SHOW INDEX FROM {$this->table}", ARRAY_A );
			foreach ( is_array( $indexes ) ? $indexes : array() as $index ) {
				if (
					'checkout_attempt_id' === (string) ( $index['Key_name'] ?? '' )
					&& 0 === (int) ( $index['Non_unique'] ?? 1 )
					&& 'checkout_attempt_id' === (string) ( $index['Column_name'] ?? '' )
				) {
					$unique_exists = true;
					break;
				}
			}
		}

		return array(
			'healthy' => $table_exists && $unique_exists,
			'table_exists' => $table_exists,
			'unique_checkout_attempt_id' => $unique_exists,
			'database_version' => (string) get_option( 'persi_headless_checkout_db_version', '' ),
			'expected_database_version' => \Persi\HeadlessCheckout\Activator::DATABASE_VERSION,
		);
	}

	public function transition( string $attempt_id, string $lease, string $from, string $to, array $fields = array() ): bool {
		$allowed = array(
			'RESERVED:ORDER_CREATED',
			'ORDER_CREATED:PAYMENT_CREATING',
			'PAYMENT_CREATING:PAYMENT_CREATED',
			'PAYMENT_CREATED:PAYMENT_PENDING',
			'PAYMENT_PENDING:PAYMENT_CONFIRMED',
			'PAYMENT_PENDING:PAYMENT_FAILED',
			'RESERVED:CANCELLED',
			'ORDER_CREATED:CANCELLED',
			'PAYMENT_CREATING:CANCELLED',
		);
		if ( ! in_array( $from . ':' . $to, $allowed, true ) ) {
			return false;
		}

		$data = array( 'state' => $to, 'updated_at' => gmdate( 'Y-m-d H:i:s' ) );
		if ( isset( $fields['order_id'] ) ) {
			$data['order_id'] = (int) $fields['order_id'];
		}
		if ( isset( $fields['provider_reference'] ) ) {
			$data['provider_reference'] = substr( (string) $fields['provider_reference'], 0, 128 );
		}

		$sets = array();
		$values = array();
		foreach ( $data as $column => $value ) {
			$sets[] = "{$column} = %s";
			$values[] = (string) $value;
		}
		$values[] = $attempt_id;
		$values[] = $from;
		$values[] = hash( 'sha256', $lease );
		$sql = $this->wpdb->prepare(
			"UPDATE {$this->table} SET " . implode( ', ', $sets ) . ' WHERE checkout_attempt_id = %s AND state = %s AND lease_hash = %s',
			...$values
		);
		return 1 === (int) $this->wpdb->query( $sql );
	}

	public function reconcile_payment( string $provider_reference, string $to ): bool {
		if ( ! in_array( $to, array( 'PAYMENT_CONFIRMED', 'PAYMENT_FAILED' ), true ) ) {
			return false;
		}
		$sql = $this->wpdb->prepare(
			"UPDATE {$this->table} SET state = %s, updated_at = %s WHERE provider_reference = %s AND state IN ('PAYMENT_CREATED', 'PAYMENT_PENDING')",
			$to,
			gmdate( 'Y-m-d H:i:s' ),
			$provider_reference
		);
		return 1 === (int) $this->wpdb->query( $sql );
	}
}
