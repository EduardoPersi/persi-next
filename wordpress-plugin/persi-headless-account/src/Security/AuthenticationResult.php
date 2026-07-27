<?php

namespace Persi\HeadlessAccount\Security;

defined( 'ABSPATH' ) || exit;

final class AuthenticationResult {
	public function __construct(
		public readonly string $key_id,
		public readonly string $nonce,
		public readonly string $origin
	) {}
}
