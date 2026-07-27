<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

final class SessionToken {
	public function generate(): string {
		return rtrim( strtr( base64_encode( random_bytes( 32 ) ), '+/', '-_' ), '=' );
	}

	public function is_valid( string $token ): bool {
		return 1 === preg_match( '/^[A-Za-z0-9_-]{43}$/', $token );
	}

	public function hash( string $token ): string {
		return hash( 'sha256', $token );
	}
}
