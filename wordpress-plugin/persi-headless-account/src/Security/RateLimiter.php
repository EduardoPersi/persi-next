<?php

namespace Persi\HeadlessAccount\Security;

use Persi\HeadlessAccount\Support\Configuration;

defined( 'ABSPATH' ) || exit;

final class RateLimiter {
	private string $table;

	public function __construct( private $database ) {
		$this->table = $database->prefix . 'persi_account_rate_limits';
	}

	public function retry_after( array $bucket_hashes, ?int $now = null ): int {
		$now       = $now ?? time();
		$max_retry = 0;
		foreach ( array_unique( array_filter( $bucket_hashes ) ) as $bucket ) {
			$blocked = $this->database->get_var(
				$this->database->prepare(
					"SELECT blocked_until FROM {$this->table}
					WHERE bucket_hash = %s LIMIT 1",
					$bucket
				)
			);
			$timestamp = is_string( $blocked ) ? strtotime( $blocked . ' UTC' ) : false;
			if ( false !== $timestamp ) {
				$max_retry = max( $max_retry, $timestamp - $now );
			}
		}
		return max( 0, $max_retry );
	}

	public function record_failure( string $bucket_hash, ?int $now = null ): int {
		$now     = $now ?? time();
		$now_sql = gmdate( 'Y-m-d H:i:s', $now );
		$cutoff  = gmdate(
			'Y-m-d H:i:s',
			$now - Configuration::LOGIN_WINDOW_SECONDS
		);

		$this->database->query( 'START TRANSACTION' );
		try {
			$this->database->query(
				$this->database->prepare(
					"INSERT IGNORE INTO {$this->table}
						(bucket_hash, window_started_at, attempts, updated_at)
					VALUES (%s, %s, 0, %s)",
					$bucket_hash,
					$now_sql,
					$now_sql
				)
			);
			$row = $this->database->get_row(
				$this->database->prepare(
					"SELECT id, window_started_at, attempts
					FROM {$this->table}
					WHERE bucket_hash = %s
					FOR UPDATE",
					$bucket_hash
				),
				ARRAY_A
			);

			$attempts = ! is_array( $row ) || $row['window_started_at'] <= $cutoff
				? 1
				: (int) $row['attempts'] + 1;
			$window_started = $attempts === 1 ? $now_sql : $row['window_started_at'];
			$backoff_exponent = min(
				10,
				max( 0, $attempts - Configuration::LOGIN_MAX_ATTEMPTS )
			);
			$backoff = $attempts >= Configuration::LOGIN_MAX_ATTEMPTS
				? min(
					Configuration::LOGIN_MAX_BACKOFF_SECONDS,
					30 * ( 2 ** $backoff_exponent )
				)
				: 0;
			$blocked = $backoff > 0
				? gmdate( 'Y-m-d H:i:s', $now + $backoff )
				: null;

			$updated = $this->database->update(
				$this->table,
				array(
					'window_started_at' => $window_started,
					'attempts'           => $attempts,
					'blocked_until'      => $blocked,
					'updated_at'         => $now_sql,
				),
				array( 'bucket_hash' => $bucket_hash ),
				array( '%s', '%d', '%s', '%s' ),
				array( '%s' )
			);
			if ( false === $updated ) {
				throw new \RuntimeException( 'rate_limit_update_failed' );
			}
			$this->database->query( 'COMMIT' );
			return $backoff;
		} catch ( \Throwable $exception ) {
			$this->database->query( 'ROLLBACK' );
			return Configuration::LOGIN_MAX_BACKOFF_SECONDS;
		}
	}

	public function clear( array $bucket_hashes ): void {
		foreach ( array_unique( array_filter( $bucket_hashes ) ) as $bucket ) {
			$this->database->delete(
				$this->table,
				array( 'bucket_hash' => $bucket ),
				array( '%s' )
			);
		}
	}
}
