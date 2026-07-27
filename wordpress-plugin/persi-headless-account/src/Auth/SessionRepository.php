<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

final class SessionRepository {
	private string $table;

	public function __construct( private $database ) {
		$this->table = $database->prefix . 'persi_account_sessions';
	}

	public function create( array $record ): bool {
		return false !== $this->database->insert(
			$this->table,
			array(
				'token_hash'          => $record['token_hash'],
				'user_id'             => $record['user_id'],
				'status'              => 'active',
				'created_at'          => $record['created_at'],
				'last_seen_at'        => $record['created_at'],
				'idle_expires_at'     => $record['idle_expires_at'],
				'absolute_expires_at' => $record['absolute_expires_at'],
				'rotation_parent_hash'=> $record['rotation_parent_hash'],
				'user_agent_hash'     => $record['user_agent_hash'],
				'ip_hash'             => $record['ip_hash'],
			),
			array( '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s' )
		);
	}

	public function find_active( string $token_hash ): ?array {
		$row = $this->database->get_row(
			$this->database->prepare(
				"SELECT id, token_hash, user_id, status, created_at, idle_expires_at,
					absolute_expires_at
				FROM {$this->table}
				WHERE token_hash = %s AND status = 'active'
				LIMIT 1",
				$token_hash
			),
			ARRAY_A
		);
		return is_array( $row ) ? $row : null;
	}

	public function touch(
		int $id,
		string $token_hash,
		string $now,
		string $idle_expires_at
	): bool {
		$result = $this->database->query(
			$this->database->prepare(
				"UPDATE {$this->table}
				SET last_seen_at = %s,
					idle_expires_at = LEAST(absolute_expires_at, %s)
				WHERE id = %d
					AND token_hash = %s
					AND status = 'active'
					AND idle_expires_at > %s
					AND absolute_expires_at > %s",
				$now,
				$idle_expires_at,
				$id,
				$token_hash,
				$now,
				$now
			)
		);
		return 1 === $result;
	}

	public function revoke( string $token_hash, string $now ): void {
		$this->database->query(
			$this->database->prepare(
				"UPDATE {$this->table}
				SET status = 'revoked', revoked_at = %s, failure_code = 'logout'
				WHERE token_hash = %s AND status = 'active'",
				$now,
				$token_hash
			)
		);
	}

	public function expire( int $id, string $code, string $now ): void {
		$this->database->query(
			$this->database->prepare(
				"UPDATE {$this->table}
				SET status = 'expired', revoked_at = %s, failure_code = %s
				WHERE id = %d AND status = 'active'",
				$now,
				$code,
				$id
			)
		);
	}
}
