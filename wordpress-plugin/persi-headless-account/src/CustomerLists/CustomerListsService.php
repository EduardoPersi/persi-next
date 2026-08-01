<?php

namespace Persi\HeadlessAccount\CustomerLists;

defined( 'ABSPATH' ) || exit;

final class CustomerListsService {
	private const LIST_TYPES = array( 'favorites' );
	private const MAX_ITEMS = 500;

	public function __construct( private readonly CustomerListRepository $repository ) {}

	public function supports( string $list_type ): bool {
		return in_array( $list_type, self::LIST_TYPES, true );
	}

	public function all( int $user_id, string $list_type ): array {
		return $this->repository->all( $user_id, $list_type );
	}

	public function add( int $user_id, string $list_type, int $product_id ): bool {
		return $this->repository->add( $user_id, $list_type, $product_id, current_time( 'mysql', true ) );
	}

	public function remove( int $user_id, string $list_type, int $product_id ): bool {
		return $this->repository->remove( $user_id, $list_type, $product_id );
	}

	public function normalize_product_ids( $payload ): ?array {
		if ( ! is_array( $payload ) || count( $payload ) > self::MAX_ITEMS ) return null;
		$ids = array();
		foreach ( $payload as $value ) {
			$id = filter_var( $value, FILTER_VALIDATE_INT, array( 'options' => array( 'min_range' => 1 ) ) );
			if ( false === $id ) return null;
			$ids[ (int) $id ] = (int) $id;
		}
		return array_values( $ids );
	}

	public function sync( int $user_id, string $list_type, array $product_ids ): bool {
		$timestamp = current_time( 'mysql', true );
		foreach ( $product_ids as $product_id ) {
			if ( ! $this->repository->add( $user_id, $list_type, $product_id, $timestamp ) ) return false;
		}
		return true;
	}
}
