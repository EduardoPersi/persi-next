<?php

namespace Persi\HeadlessAccount\Security;

use RuntimeException;

defined( 'ABSPATH' ) || exit;

final class AuthenticationException extends RuntimeException {
	private string $error_code;

	public function __construct( string $error_code ) {
		parent::__construct( 'Request authentication failed.' );
		$this->error_code = $error_code;
	}

	public function error_code(): string {
		return $this->error_code;
	}
}
