<?php

namespace Persi\HeadlessAccount\CustomerWorkspace;

defined( 'ABSPATH' ) || exit;

final class CustomerWorkspaceService {
	public function __construct( private $database ) {}

	public function summary( \WP_User $user ): array {
		$orders = wc_get_orders( array( 'customer_id' => $user->ID, 'limit' => 1, 'paginate' => true, 'return' => 'ids' ) );
		$list_table = $this->database->prefix . 'persi_customer_lists';
		$list_rows = $this->database->get_results( $this->database->prepare(
			"SELECT list_type, COUNT(*) item_count FROM {$list_table} WHERE user_id=%d GROUP BY list_type",
			$user->ID
		), ARRAY_A );
		$favorites = 0;
		$lists = 0;
		foreach ( is_array( $list_rows ) ? $list_rows : array() as $row ) {
			++$lists;
			if ( 'favorites' === $row['list_type'] ) $favorites = (int) $row['item_count'];
		}
		$customer = new \WC_Customer( $user->ID );
		$address_count = ( '' !== trim( $customer->get_billing_address_1() ) ? 1 : 0 ) + ( '' !== trim( $customer->get_shipping_address_1() ) ? 1 : 0 );
		return array(
			'orders' => isset( $orders->total ) ? (int) $orders->total : 0,
			'favorites' => $favorites,
			'lists' => $lists,
			'addresses' => $address_count,
		);
	}

	public function profile( \WP_User $user ): array {
		$customer = new \WC_Customer( $user->ID );
		return array(
			'firstName' => $customer->get_first_name(),
			'lastName' => $customer->get_last_name(),
			'displayName' => $customer->get_display_name(),
			'email' => $customer->get_email(),
			'phone' => $customer->get_billing_phone(),
			'birthDate' => (string) get_user_meta( $user->ID, 'birth_date', true ),
			'cpf' => (string) get_user_meta( $user->ID, 'billing_cpf', true ),
		);
	}

	public function update_profile( \WP_User $user, array $input ): bool {
		$customer = new \WC_Customer( $user->ID );
		$customer->set_first_name( $input['firstName'] );
		$customer->set_last_name( $input['lastName'] );
		$customer->set_display_name( trim( $input['firstName'] . ' ' . $input['lastName'] ) );
		$customer->set_billing_phone( $input['phone'] );
		$customer->save();
		update_user_meta( $user->ID, 'birth_date', $input['birthDate'] );
		update_user_meta( $user->ID, 'billing_cpf', $input['cpf'] );
		return true;
	}

	public function change_password( \WP_User $user, string $current, string $new ): bool {
		if ( ! wp_check_password( $current, $user->user_pass, $user->ID ) ) return false;
		wp_set_password( $new, $user->ID );
		return true;
	}

	public function addresses( \WP_User $user ): array {
		$customer = new \WC_Customer( $user->ID );
		$primary = (string) get_user_meta( $user->ID, 'persi_primary_address_type', true );
		if ( ! in_array( $primary, array( 'billing', 'shipping' ), true ) ) $primary = 'shipping';
		return array( $this->address( $customer, 'billing', $primary ), $this->address( $customer, 'shipping', $primary ) );
	}

	private function address( \WC_Customer $customer, string $type, string $primary ): array {
		$get = static fn( string $field ): string => (string) $customer->{"get_{$type}_{$field}"}();
		return array(
			'id' => $type, 'type' => $type, 'label' => 'billing' === $type ? 'Cobrança' : 'Entrega',
			'firstName' => $get( 'first_name' ), 'lastName' => $get( 'last_name' ), 'company' => $get( 'company' ),
			'address1' => $get( 'address_1' ), 'address2' => $get( 'address_2' ), 'city' => $get( 'city' ),
			'state' => $get( 'state' ), 'postcode' => $get( 'postcode' ), 'country' => $get( 'country' ),
			'phone' => 'billing' === $type ? $get( 'phone' ) : '', 'isPrimary' => $primary === $type,
		);
	}

	public function update_address( \WP_User $user, string $type, array $input ): array {
		$customer = new \WC_Customer( $user->ID );
		foreach ( array( 'first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country' ) as $field ) {
			$key = lcfirst( str_replace( '_', '', ucwords( $field, '_' ) ) );
			$customer->{"set_{$type}_{$field}"}( $input[ $key ] );
		}
		if ( 'billing' === $type ) $customer->set_billing_phone( $input['phone'] );
		$customer->save();
		return $this->addresses( $user );
	}

	public function clear_address( \WP_User $user, string $type ): array {
		$empty = array_fill_keys( array( 'firstName','lastName','company','address1','address2','city','state','postcode','country','phone' ), '' );
		return $this->update_address( $user, $type, $empty );
	}

	public function set_primary_address( \WP_User $user, string $type ): array {
		update_user_meta( $user->ID, 'persi_primary_address_type', $type );
		return $this->addresses( $user );
	}

	public function connected_accounts( \WP_User $user ): array {
		$table = $this->database->prefix . 'persi_account_identities';
		$providers = $this->database->get_col( $this->database->prepare( "SELECT provider FROM {$table} WHERE user_id=%d ORDER BY provider", $user->ID ) );
		return array_map( static fn( string $provider ): array => array( 'provider' => $provider, 'connected' => true ), is_array( $providers ) ? $providers : array() );
	}

	public function stock_notifications( \WP_User $user ): array {
		$table = $this->database->prefix . 'persi_stock_notifications';
		if ( $this->database->get_var( $this->database->prepare( 'SHOW TABLES LIKE %s', $table ) ) !== $table ) return array();
		$email_hash = hash_hmac( 'sha256', strtolower( $user->user_email ), wp_salt( 'secure_auth' ) );
		$rows = $this->database->get_results( $this->database->prepare(
			"SELECT id,product_id,variation_id,status,created_at,sent_at FROM {$table} WHERE email_hash=%s AND status<>'anonymized' ORDER BY created_at DESC LIMIT 100",
			$email_hash
		), ARRAY_A );
		return array_map( static function( array $row ): array {
			$product = wc_get_product( (int) ( $row['variation_id'] ?: $row['product_id'] ) );
			return array(
				'id'=>(int)$row['id'], 'productId'=>(int)$row['product_id'], 'productName'=>$product ? $product->get_name() : 'Produto',
				'productUrl'=>$product ? get_permalink( $product->get_id() ) : '', 'status'=>(string)$row['status'],
				'createdAt'=>gmdate( 'c', strtotime( $row['created_at'] . ' UTC' ) ), 'notified'=>! empty( $row['sent_at'] ),
			);
		}, is_array( $rows ) ? $rows : array() );
	}

	public function remove_stock_notification( \WP_User $user, int $id ): bool {
		$table = $this->database->prefix . 'persi_stock_notifications';
		$email_hash = hash_hmac( 'sha256', strtolower( $user->user_email ), wp_salt( 'secure_auth' ) );
		return false !== $this->database->update( $table, array( 'status'=>'unsubscribed','updated_at'=>current_time( 'mysql', true ) ), array( 'id'=>$id,'email_hash'=>$email_hash ), array('%s','%s'), array('%d','%s') );
	}
}
