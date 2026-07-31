<?php

namespace Persi\HeadlessAccount\Favorites;

defined( 'ABSPATH' ) || exit;

final class FavoriteRepository {
	private string $table;

	public function __construct( private $database ) {
		$this->table = $database->prefix . 'persi_favorites';
	}

	public function all( int $user_id ): array {
		$rows = $this->database->get_results(
			$this->database->prepare(
				"SELECT product_id, created_at FROM {$this->table} WHERE user_id = %d ORDER BY created_at DESC, id DESC",
				$user_id
			),
			ARRAY_A
		);
		return is_array( $rows ) ? array_map( static fn( array $row ): array => array(
			'productId' => (int) $row['product_id'],
			'createdAt' => gmdate( 'c', strtotime( $row['created_at'] . ' UTC' ) ),
		), $rows ) : array();
	}

	public function add( int $user_id, int $product_id, string $created_at ): bool {
		$result = $this->database->query( $this->database->prepare(
			"INSERT IGNORE INTO {$this->table} (user_id, product_id, created_at) VALUES (%d, %d, %s)",
			$user_id, $product_id, $created_at
		) );
		return false !== $result;
	}

	public function remove( int $user_id, int $product_id ): bool {
		return false !== $this->database->delete(
			$this->table,
			array( 'user_id' => $user_id, 'product_id' => $product_id ),
			array( '%d', '%d' )
		);
	}

	public function sync( int $user_id, array $product_ids, string $created_at ): bool {
		foreach ( $product_ids as $product_id ) {
			if ( ! $this->add( $user_id, $product_id, $created_at ) ) return false;
		}
		return true;
	}
}
