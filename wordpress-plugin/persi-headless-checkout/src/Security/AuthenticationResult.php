<?php

namespace Persi\HeadlessCheckout\Security;

defined( 'ABSPATH' ) || exit;

final class AuthenticationResult {
	public $key_id;
	public $nonce;
	public $origin;

	public function __construct( string $key_id, string $nonce, string $origin ) {
		$this->key_id = $key_id;
		$this->nonce  = $nonce;
		$this->origin = $origin;
	}
}
