<?php

namespace Persi\HeadlessAccount\CustomerLists;

defined( 'ABSPATH' ) || exit;

final class CustomerListRepository {
	private string $table;

	public function __construct( private $database ) {
		$this->table = $database->prefix . 'persi_customer_lists';
	}

	public function all( int $user_id, string $list_type ): array {
		$rows = $this->database->get_results(
			$this->database->prepare(
				"SELECT product_id, created_at, updated_at FROM {$this->table} WHERE user_id = %d AND list_type = %s ORDER BY created_at DESC, id DESC",
				$user_id,
				$list_type
			),
			ARRAY_A
		);

		return is_array( $rows ) ? array_map(
			static fn( array $row ): array => array(
				'productId' => (int) $row['product_id'],
				'createdAt' => gmdate( 'c', strtotime( $row['created_at'] . ' UTC' ) ),
				'updatedAt' => gmdate( 'c', strtotime( $row['updated_at'] . ' UTC' ) ),
			),
			$rows
		) : array();
	}

	public function add( int $user_id, string $list_type, int $product_id, string $timestamp ): bool {
		$result = $this->database->query(
			$this->database->prepare(
				"INSERT INTO {$this->table} (user_id, list_type, product_id, created_at, updated_at) VALUES (%d, %s, %d, %s, %s) ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)",
				$user_id,
				$list_type,
				$product_id,
				$timestamp,
				$timestamp
			)
		);
		return false !== $result;
	}

	public function remove( int $user_id, string $list_type, int $product_id ): bool {
		return false !== $this->database->delete(
			$this->table,
			array( 'user_id' => $user_id, 'list_type' => $list_type, 'product_id' => $product_id ),
			array( '%d', '%s', '%d' )
		);
	}
}
