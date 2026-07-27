<?php

namespace Persi\HeadlessAccount\Security;

defined( 'ABSPATH' ) || exit;

final class NonceRepository {
	private $database;
	private string $table;

	public function __construct( $database ) {
		$this->database = $database;
		$this->table    = $database->prefix . 'persi_account_nonces';
	}

	public function claim( string $nonce_hash, int $now, int $ttl ): bool {
		$created = gmdate( 'Y-m-d H:i:s', $now );
		$expires = gmdate( 'Y-m-d H:i:s', $now + $ttl );
		$result  = $this->database->query(
			$this->database->prepare(
				"INSERT IGNORE INTO {$this->table}
					(nonce_hash, expires_at, created_at)
				VALUES (%s, %s, %s)",
				$nonce_hash,
				$expires,
				$created
			)
		);

		if ( 1 === $result && 0 === random_int( 0, 100 ) ) {
			$this->database->query(
				$this->database->prepare(
					"DELETE FROM {$this->table} WHERE expires_at <= %s",
					$created
				)
			);
		}

		return 1 === $result;
	}
}
