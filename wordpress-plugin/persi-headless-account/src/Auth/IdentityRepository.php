<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

final class IdentityRepository {
	private string $table;

	public function __construct( private $database ) {
		$this->table = $database->prefix . 'persi_account_identities';
	}

	public function find_google( string $subject_hash ): ?array {
		$row = $this->database->get_row(
			$this->database->prepare(
				"SELECT id, user_id, provider, provider_subject_hash, email_hash
				FROM {$this->table}
				WHERE provider = 'google' AND provider_subject_hash = %s
				LIMIT 1",
				$subject_hash
			),
			ARRAY_A
		);
		return is_array( $row ) ? $row : null;
	}

	public function create_google(
		int $user_id,
		string $subject_hash,
		string $email_hash,
		string $now
	): bool {
		return 1 === $this->database->insert(
			$this->table,
			array(
				'user_id'               => $user_id,
				'provider'              => 'google',
				'provider_subject_hash' => $subject_hash,
				'email_hash'            => $email_hash,
				'created_at'            => $now,
				'updated_at'            => $now,
				'last_login_at'         => $now,
			),
			array( '%d', '%s', '%s', '%s', '%s', '%s', '%s' )
		);
	}

	public function touch( int $id, string $now ): void {
		$this->database->update(
			$this->table,
			array(
				'updated_at'    => $now,
				'last_login_at' => $now,
			),
			array( 'id' => $id ),
			array( '%s', '%s' ),
			array( '%d' )
		);
	}

	public function acquire_locks( array $hashes ): bool {
		foreach ( array_unique( $hashes ) as $hash ) {
			$name = 'persi_google_' . substr( $hash, 0, 48 );
			if (
				1 !== (int) $this->database->get_var(
					$this->database->prepare( 'SELECT GET_LOCK(%s, 5)', $name )
				)
			) {
				$this->release_locks( $hashes );
				return false;
			}
		}
		return true;
	}

	public function release_locks( array $hashes ): void {
		foreach ( array_unique( $hashes ) as $hash ) {
			$name = 'persi_google_' . substr( $hash, 0, 48 );
			$this->database->get_var(
				$this->database->prepare( 'SELECT RELEASE_LOCK(%s)', $name )
			);
		}
	}
}
