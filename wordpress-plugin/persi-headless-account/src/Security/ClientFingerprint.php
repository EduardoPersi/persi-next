<?php

namespace Persi\HeadlessAccount\Security;

defined( 'ABSPATH' ) || exit;

final class ClientFingerprint {
	public function __construct( private readonly string $secret ) {}

	public function ip_hash( array $server ): ?string {
		$ip = $this->resolve_ip( $server );
		return '' === $ip ? null : hash( 'sha256', $this->secret . '|ip|' . $ip );
	}

	public function user_agent_hash( array $server ): ?string {
		$value = isset( $server['HTTP_USER_AGENT'] )
			? trim( (string) $server['HTTP_USER_AGENT'] )
			: '';
		return '' === $value
			? null
			: hash( 'sha256', $this->secret . '|ua|' . substr( $value, 0, 512 ) );
	}

	private function resolve_ip( array $server ): string {
		$remote = isset( $server['REMOTE_ADDR'] )
			? trim( (string) $server['REMOTE_ADDR'] )
			: '';

		$trust_proxy = defined( 'PERSI_HEADLESS_ACCOUNT_TRUST_PROXY_HEADERS' ) &&
			true === constant( 'PERSI_HEADLESS_ACCOUNT_TRUST_PROXY_HEADERS' );

		if ( $trust_proxy && ! empty( $server['HTTP_CF_CONNECTING_IP'] ) ) {
			$candidate = trim( (string) $server['HTTP_CF_CONNECTING_IP'] );
			if ( false !== filter_var( $candidate, FILTER_VALIDATE_IP ) ) {
				return $candidate;
			}
		}

		return false !== filter_var( $remote, FILTER_VALIDATE_IP ) ? $remote : '';
	}
}
