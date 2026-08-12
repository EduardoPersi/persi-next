<?php

namespace Persi\HeadlessCheckout\Validation;

use RuntimeException;

defined( 'ABSPATH' ) || exit;

final class ValidationException extends RuntimeException {
	private $error_code;

	public function __construct( string $error_code ) {
		parent::__construct( 'Invalid checkout transfer payload.' );
		$this->error_code = $error_code;
	}

	public function get_error_code(): string {
		return $this->error_code;
	}
}
