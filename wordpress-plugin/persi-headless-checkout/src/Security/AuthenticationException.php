<?php

namespace Persi\HeadlessCheckout\Security;

use RuntimeException;

defined( 'ABSPATH' ) || exit;

final class AuthenticationException extends RuntimeException {
	private $error_code;

	public function __construct( string $error_code ) {
		parent::__construct( 'Request authentication failed.' );
		$this->error_code = $error_code;
	}

	public function get_error_code(): string {
		return $this->error_code;
	}
}
