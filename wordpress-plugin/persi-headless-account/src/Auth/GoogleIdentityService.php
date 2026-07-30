<?php

namespace Persi\HeadlessAccount\Auth;

defined( 'ABSPATH' ) || exit;

final class GoogleIdentityService {
	private OAuthIdentityService $oauth;

	public function __construct(
		IdentityRepository $identities,
		string $secret
	) {
		$this->oauth = new OAuthIdentityService( $identities, $secret );
	}

	public function resolve( array $identity, ?int $now = null ): ?\WP_User {
		return $this->oauth->resolve(
			array(
				'provider'    => 'google',
				'provider_id' => $identity['subject'],
				'email'       => $identity['email'],
				'name'        => $identity['display_name'],
				'avatar'      => $identity['picture'] ?? '',
				'first_name'  => $identity['first_name'],
				'last_name'   => $identity['last_name'],
			),
			$now
		);
	}

	public function last_code(): string {
		return $this->oauth->last_code();
	}

	public function user_was_created(): bool {
		return $this->oauth->user_was_created();
	}
}
