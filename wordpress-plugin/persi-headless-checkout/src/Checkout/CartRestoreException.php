<?php

namespace Persi\HeadlessCheckout\Checkout;

use RuntimeException;

defined( 'ABSPATH' ) || exit;

final class CartRestoreException extends RuntimeException {
	private $failure_code;

	public function __construct( string $failure_code ) {
		parent::__construct( 'Checkout cart restoration failed.' );
		$this->failure_code = $failure_code;
	}

	public function get_failure_code(): string {
		return $this->failure_code;
	}
}
