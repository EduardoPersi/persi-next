<?php

declare(strict_types=1);

define( 'ABSPATH', __DIR__ . '/' );
define( 'ARRAY_A', 'ARRAY_A' );
define( 'PERSI_HEADLESS_ACCOUNT_HMAC_SECRET', 'test-secret-placeholder-not-real' );
define( 'PERSI_HEADLESS_ACCOUNT_HMAC_KEY_ID', 'primary' );
define( 'PERSI_HEADLESS_ACCOUNT_ALLOWED_ORIGINS', 'https://frontend.test' );

final class WP_User {
	public int $ID;
	public int $user_status = 0;
	public array $roles;
	public string $display_name;
	public string $user_email;

	public function __construct(
		int $id,
		array $roles = array( 'customer' ),
		string $email = 'cliente@example.test'
	) {
		$this->ID           = $id;
		$this->roles        = $roles;
		$this->display_name = 'Cliente Teste';
		$this->user_email   = $email;
	}
}

final class WP_Error {}

$GLOBALS['test_users'] = array();
$GLOBALS['auth_result'] = null;
$GLOBALS['inserted_users'] = array();

function get_user_by( string $field, $value ) {
	if ( 'id' === $field ) {
		return $GLOBALS['test_users'][ (int) $value ] ?? false;
	}
	if ( 'email' === $field ) {
		foreach ( $GLOBALS['test_users'] as $user ) {
			if ( $user->user_email === $value ) return $user;
		}
	}
	return false;
}

function wp_authenticate( string $identifier, string $password ) {
	return $GLOBALS['auth_result'] ?? new WP_Error();
}

function is_wp_error( $value ): bool {
	return $value instanceof WP_Error;
}

function sanitize_email( string $email ): string {
	return filter_var( $email, FILTER_SANITIZE_EMAIL );
}

function is_email( string $email ): bool {
	return false !== filter_var( $email, FILTER_VALIDATE_EMAIL );
}

function wp_parse_url( string $url ) {
	return parse_url( $url );
}

function wp_generate_password( int $length, bool $special, bool $extra ): string {
	return str_repeat( 'x', $length );
}

function sanitize_user( string $value, bool $strict ): string {
	return preg_replace( '/[^a-z0-9._-]/i', '', $value );
}

function username_exists( string $username ): bool {
	return isset( $GLOBALS['inserted_users'][ $username ] );
}

function wp_insert_user( array $data ) {
	$id = count( $GLOBALS['test_users'] ) + 100;
	$user = new WP_User( $id, array( $data['role'] ), $data['user_email'] );
	$user->display_name = $data['display_name'];
	$GLOBALS['test_users'][ $id ] = $user;
	$GLOBALS['inserted_users'][ $data['user_login'] ] = $id;
	return $id;
}

if ( ! function_exists( 'mb_strlen' ) ) {
	function mb_strlen( string $value ): int {
		return strlen( $value );
	}
}

final class FakeWpdb {
	public string $prefix = 'wp_';
	public array $sessions = array();
	public array $nonces = array();
	public array $limits = array();
	public array $identities = array();
	public bool $fail_session_insert = false;
	private int $next_id = 1;

	public function prepare( string $query, ...$args ): array {
		return array( $query, $args );
	}

	public function insert( string $table, array $data, array $formats ) {
		if ( str_contains( $table, 'sessions' ) ) {
			if ( $this->fail_session_insert ) {
				return false;
			}
			foreach ( $this->sessions as $row ) {
				if ( $row['token_hash'] === $data['token_hash'] ) {
					return false;
				}
			}
			$data['id'] = $this->next_id++;
			$this->sessions[] = $data;
			return 1;
		}
		if ( str_contains( $table, 'identities' ) ) {
			foreach ( $this->identities as $identity ) {
				if (
					$identity['provider'] === $data['provider'] &&
					(
						$identity['provider_subject_hash'] === $data['provider_subject_hash'] ||
						$identity['email_hash'] === $data['email_hash']
					)
				) {
					return false;
				}
			}
			$data['id'] = $this->next_id++;
			$this->identities[] = $data;
			return 1;
		}
		return false;
	}

	public function query( $statement ) {
		if ( is_string( $statement ) ) {
			return 1;
		}
		[ $query, $args ] = $statement;
		if ( str_contains( $query, 'INSERT IGNORE' ) && str_contains( $query, 'nonces' ) ) {
			if ( isset( $this->nonces[ $args[0] ] ) ) return 0;
			$this->nonces[ $args[0] ] = $args[1];
			return 1;
		}
		if ( str_contains( $query, 'INSERT IGNORE' ) && str_contains( $query, 'rate_limits' ) ) {
			if ( isset( $this->limits[ $args[0] ] ) ) return 0;
			$this->limits[ $args[0] ] = array(
				'id' => $this->next_id++,
				'bucket_hash' => $args[0],
				'window_started_at' => $args[1],
				'attempts' => 0,
				'blocked_until' => null,
				'updated_at' => $args[2],
			);
			return 1;
		}
		if ( str_contains( $query, 'SET last_seen_at' ) ) {
			foreach ( $this->sessions as &$row ) {
				if (
					$row['id'] === $args[2] &&
					$row['token_hash'] === $args[3] &&
					'active' === $row['status'] &&
					$row['idle_expires_at'] > $args[4] &&
					$row['absolute_expires_at'] > $args[5]
				) {
					$next_idle = min( $row['absolute_expires_at'], $args[1] );
					$changed = $row['last_seen_at'] !== $args[0] ||
						$row['idle_expires_at'] !== $next_idle;
					$row['last_seen_at'] = $args[0];
					$row['idle_expires_at'] = $next_idle;
					return $changed ? 1 : 0;
				}
			}
			return 0;
		}
		if ( str_contains( $query, "SET status = 'revoked'" ) ) {
			foreach ( $this->sessions as &$row ) {
				if ( $row['token_hash'] === $args[1] && 'active' === $row['status'] ) {
					$row['status'] = 'revoked';
					$row['revoked_at'] = $args[0];
					$row['failure_code'] = 'logout';
					return 1;
				}
			}
			return 0;
		}
		if ( str_contains( $query, "SET status = 'expired'" ) ) {
			foreach ( $this->sessions as &$row ) {
				if ( $row['id'] === $args[2] && 'active' === $row['status'] ) {
					$row['status'] = 'expired';
					$row['revoked_at'] = $args[0];
					$row['failure_code'] = $args[1];
					return 1;
				}
			}
			return 0;
		}
		return 1;
	}

	public function get_row( $statement, $output ) {
		[ $query, $args ] = $statement;
		if ( str_contains( $query, 'rate_limits' ) ) {
			return $this->limits[ $args[0] ] ?? null;
		}
		if ( str_contains( $query, 'persi_account_identities' ) ) {
			foreach ( $this->identities as $identity ) {
				if (
					'google' === $identity['provider'] &&
					$identity['provider_subject_hash'] === $args[0]
				) {
					return $identity;
				}
			}
			return null;
		}
		foreach ( $this->sessions as $row ) {
			if ( $row['token_hash'] === $args[0] && 'active' === $row['status'] ) {
				return $row;
			}
		}
		return null;
	}

	public function get_var( $statement ) {
		[ $query, $args ] = $statement;
		if ( str_contains( $query, 'GET_LOCK' ) || str_contains( $query, 'RELEASE_LOCK' ) ) {
			return 1;
		}
		if ( str_contains( $query, 'persi_account_sessions' ) ) {
			foreach ( $this->sessions as $row ) {
				if (
					$row['id'] === $args[0] &&
					$row['token_hash'] === $args[1] &&
					'active' === $row['status'] &&
					$row['idle_expires_at'] > $args[2] &&
					$row['absolute_expires_at'] > $args[3]
				) {
					return 1;
				}
			}
			return null;
		}
		return $this->limits[ $args[0] ]['blocked_until'] ?? null;
	}

	public function update( string $table, array $data, array $where ) {
		if ( str_contains( $table, 'identities' ) ) {
			foreach ( $this->identities as &$identity ) {
				if ( $identity['id'] === $where['id'] ) {
					$identity = array_merge( $identity, $data );
					return 1;
				}
			}
			return 0;
		}
		$this->limits[ $where['bucket_hash'] ] = array_merge(
			$this->limits[ $where['bucket_hash'] ],
			$data
		);
		return 1;
	}

	public function delete( string $table, array $where ) {
		unset( $this->limits[ $where['bucket_hash'] ] );
		return 1;
	}
}

$root = dirname( __DIR__ );
$load = static function ( string $file ) use ( $root ): void {
	require_once $root . '/src/' . $file;
};

$load( 'Support/OriginNormalizer.php' );
$load( 'Support/Configuration.php' );
$load( 'Security/AuthenticationException.php' );
$load( 'Security/AuthenticationResult.php' );
$load( 'Security/NonceRepository.php' );
$load( 'Security/RequestAuthenticator.php' );
$load( 'Security/RateLimiter.php' );
$load( 'Auth/SessionToken.php' );
$load( 'Auth/SessionRepository.php' );
$load( 'Auth/CredentialsAuthenticator.php' );
$load( 'Auth/SessionService.php' );
$load( 'Auth/IdentityRepository.php' );
$load( 'Auth/GoogleIdentityService.php' );
$load( 'Validation/ValidationException.php' );
$load( 'Validation/LoginPayloadValidator.php' );
$load( 'Validation/AccountAccessPayloadValidator.php' );
$load( 'Validation/GoogleLoginPayloadValidator.php' );
$load( 'Orders/OrderPresenter.php' );
$load( 'Orders/OrderService.php' );

use Persi\HeadlessAccount\Auth\CredentialsAuthenticator;
use Persi\HeadlessAccount\Auth\SessionRepository;
use Persi\HeadlessAccount\Auth\SessionService;
use Persi\HeadlessAccount\Auth\SessionToken;
use Persi\HeadlessAccount\Auth\IdentityRepository;
use Persi\HeadlessAccount\Auth\GoogleIdentityService;
use Persi\HeadlessAccount\Security\AuthenticationException;
use Persi\HeadlessAccount\Security\NonceRepository;
use Persi\HeadlessAccount\Security\RateLimiter;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\OriginNormalizer;
use Persi\HeadlessAccount\Validation\LoginPayloadValidator;
use Persi\HeadlessAccount\Validation\AccountAccessPayloadValidator;
use Persi\HeadlessAccount\Validation\GoogleLoginPayloadValidator;
use Persi\HeadlessAccount\Validation\ValidationException;
use Persi\HeadlessAccount\Orders\OrderPresenter;

$tests = array();
$test = static function ( string $name, callable $callback ) use ( &$tests ): void {
	$tests[] = array( $name, $callback );
};
$assert = static function ( bool $condition, string $message = 'assertion failed' ): void {
	if ( ! $condition ) throw new RuntimeException( $message );
};
$throws = static function ( callable $callback, string $class ) use ( $assert ): void {
	try {
		$callback();
	} catch ( Throwable $error ) {
		$assert( $error instanceof $class, 'unexpected exception' );
		return;
	}
	throw new RuntimeException( 'exception not thrown' );
};

$test( 'token possui 43 caracteres, é único e só gera hash persistível', static function () use ( $assert ): void {
	$tokens = new SessionToken();
	$first = $tokens->generate();
	$second = $tokens->generate();
	$assert( 43 === strlen( $first ) && $first !== $second );
	$assert( 1 === preg_match( '/^[a-f0-9]{64}$/', $tokens->hash( $first ) ) );
} );

$test( 'validador mantém senha intacta e rejeita contrato aberto', static function () use ( $assert, $throws ): void {
	$validator = new LoginPayloadValidator();
	$value = $validator->validate( '{"identifier":" user ","password":"  senha  ","remember":false}' );
	$assert( 'user' === $value['identifier'] );
	$assert( '  senha  ' === $value['password'] );
	$throws(
		static fn() => $validator->validate( '{"identifier":"u","password":"p","remember":false,"role":"admin"}' ),
		ValidationException::class
	);
	$throws(
		static fn() => $validator->validate( '{"identifier":"u","password":"p"}' ),
		ValidationException::class
	);
	$throws(
		static fn() => $validator->validate( '{"identifier":"u","password":"p","remember":"yes"}' ),
		ValidationException::class
	);
} );

$test( 'origem rejeita caminho, query, fragmento e credenciais', static function () use ( $assert ): void {
	$assert( 'https://frontend.test' === OriginNormalizer::normalize( 'HTTPS://FRONTEND.TEST/' ) );
	foreach ( array(
		'https://frontend.test/path',
		'https://frontend.test?x=1',
		'https://frontend.test/#x',
		'https://user@frontend.test',
		'javascript:alert(1)',
	) as $origin ) {
		$assert( '' === OriginNormalizer::normalize( $origin ) );
	}
} );

$test( 'HMAC válido passa e replay, adulteração, timestamp, origem e key ID falham', static function () use ( $assert, $throws ): void {
	$db = new FakeWpdb();
	$config = new Configuration();
	$auth = new RequestAuthenticator( $config, new NonceRepository( $db ) );
	$now = 1800000000;
	$body = '{"identifier":"u","password":"p","remember":false}';
	$nonce = 'abcdefghijklmnopqrstuv';
	$canonical = RequestAuthenticator::canonical(
		'POST',
		'/wp-json/persi-account/v1/login',
		(string) $now,
		$nonce,
		'https://frontend.test',
		$body
	);
	$headers = array(
		'x-persi-key-id' => 'primary',
		'x-persi-timestamp' => (string) $now,
		'x-persi-nonce' => $nonce,
		'x-persi-origin' => 'https://frontend.test',
		'x-persi-signature' => 'v1=' . hash_hmac( 'sha256', $canonical, PERSI_HEADLESS_ACCOUNT_HMAC_SECRET ),
	);
	$result = $auth->authenticate( 'POST', '/wp-json/persi-account/v1/login', $headers, $body, $now );
	$assert( 'primary' === $result->key_id );
	$throws(
		static fn() => $auth->authenticate( 'POST', '/wp-json/persi-account/v1/login', $headers, $body, $now ),
		AuthenticationException::class
	);

	foreach ( array(
		array( 'body' => $body . ' ', 'headers' => $headers, 'now' => $now ),
		array(
			'body' => $body,
			'headers' => array_merge(
				$headers,
				array(
					'x-persi-nonce' => 'wrongsecretabcdefghijkl',
					'x-persi-signature' => 'v1=' . hash_hmac( 'sha256', RequestAuthenticator::canonical(
						'POST',
						'/wp-json/persi-account/v1/login',
						(string) $now,
						'wrongsecretabcdefghijkl',
						'https://frontend.test',
						$body
					), 'incorrect-secret' ),
				)
			),
			'now' => $now,
		),
		array( 'body' => $body, 'headers' => array_merge( $headers, array( 'x-persi-signature' => 'v1=' . str_repeat( '0', 64 ) ) ), 'now' => $now ),
		array( 'body' => $body, 'headers' => array_merge( $headers, array( 'x-persi-key-id' => 'keyid2' ) ), 'now' => $now ),
		array( 'body' => $body, 'headers' => array_merge( $headers, array( 'x-persi-origin' => 'https://evil.test' ) ), 'now' => $now ),
		array( 'body' => $body, 'headers' => $headers, 'now' => $now + 121 ),
	) as $case ) {
		$fresh = new RequestAuthenticator( $config, new NonceRepository( new FakeWpdb() ) );
		$throws(
			static fn() => $fresh->authenticate(
				'POST',
				'/wp-json/persi-account/v1/login',
				$case['headers'],
				$case['body'],
				$case['now']
			),
			AuthenticationException::class
		);
	}
} );

$test( 'Key ID HMAC não diferencia maiúsculas e minúsculas', static function () use ( $assert ): void {
	$config = new Configuration();
	$now = 1800000000;
	$body = '{"identifier":"u","password":"p","remember":false}';

	foreach ( array( 'primary', 'PRIMARY', 'Primary', 'PrImArY' ) as $index => $key_id ) {
		$nonce = 'caseinsensitivekeyid0' . $index;
		$canonical = RequestAuthenticator::canonical(
			'POST',
			'/wp-json/persi-account/v1/login',
			(string) $now,
			$nonce,
			'https://frontend.test',
			$body
		);
		$headers = array(
			'x-persi-key-id' => $key_id,
			'x-persi-timestamp' => (string) $now,
			'x-persi-nonce' => $nonce,
			'x-persi-origin' => 'https://frontend.test',
			'x-persi-signature' => 'v1=' . hash_hmac( 'sha256', $canonical, PERSI_HEADLESS_ACCOUNT_HMAC_SECRET ),
		);
		$auth = new RequestAuthenticator( $config, new NonceRepository( new FakeWpdb() ) );
		$result = $auth->authenticate( 'POST', '/wp-json/persi-account/v1/login', $headers, $body, $now );
		$assert( $key_id === $result->key_id );
	}
} );

$test( 'login aceita somente customer e subscriber', static function () use ( $assert ): void {
	$authenticator = new CredentialsAuthenticator();
	$GLOBALS['auth_result'] = new WP_User( 1, array( 'customer' ) );
	$assert( $authenticator->authenticate( 'x', 'valid' ) instanceof WP_User );
	$GLOBALS['auth_result'] = new WP_User( 2, array( 'administrator' ) );
	$assert( null === $authenticator->authenticate( 'x', 'valid' ) );
	$assert( 'ACCOUNT_LOGIN_ROLE_REJECTED' === $authenticator->error_code() );
	$GLOBALS['auth_result'] = new WP_Error();
	$assert( null === $authenticator->authenticate( 'missing', 'invalid' ) );
	$assert( 'ACCOUNT_LOGIN_CREDENTIALS_REJECTED' === $authenticator->error_code() );
} );

$test( 'login encaminha e-mail, usuário e senha sem alteração ao wp_authenticate', static function () use ( $assert ): void {
	$authenticator = new CredentialsAuthenticator();
	foreach ( array( 'cliente@example.test', 'cliente' ) as $identifier ) {
		$GLOBALS['auth_result'] = new WP_User( 3, array( 'customer' ) );
		$assert( $authenticator->authenticate( $identifier, ' senha exata ' ) instanceof WP_User );
	}
} );

$test( 'sessão renova inatividade, expira, revoga e não armazena token bruto', static function () use ( $assert ): void {
	$db = new FakeWpdb();
	$repository = new SessionRepository( $db );
	$service = new SessionService( $repository, new SessionToken() );
	$user = new WP_User( 10 );
	$GLOBALS['test_users'][10] = $user;
	$now = 1800000000;
	$created = $service->create( $user, false, str_repeat( 'a', 64 ), str_repeat( 'b', 64 ), $now );
	$assert( is_array( $created ) );
	$assert( 'ACCOUNT_SESSION_VALID' === $service->last_code() );
	$assert( ! isset( $db->sessions[0]['token'] ) );
	$assert( $db->sessions[0]['token_hash'] === hash( 'sha256', $created['token'] ) );
	$same_second = $service->resolve( $created['token'], $now );
	$assert( is_array( $same_second ) && 'ACCOUNT_SESSION_VALID' === $service->last_code() );
	$resolved = $service->resolve( $created['token'], $now + 60 );
	$assert( is_array( $resolved ) && 10 === $resolved['user']->ID );
	$service->logout( $created['token'], $now + 61 );
	$assert( null === $service->resolve( $created['token'], $now + 62 ) );
	$assert( 'ACCOUNT_SESSION_NOT_FOUND' === $service->last_code() );
	$service->logout( $created['token'], $now + 63 );

	$expired = $service->create( $user, false, null, null, $now );
	$assert( null === $service->resolve( $expired['token'], $now + Configuration::IDLE_SECONDS + 1 ) );
	$assert( 'ACCOUNT_SESSION_EXPIRED' === $service->last_code() );
	$absolute = $service->create( $user, true, null, null, $now );
	$assert( null === $service->resolve( $absolute['token'], $now + Configuration::REMEMBER_ABSOLUTE_SECONDS + 1 ) );
	$assert( 'ACCOUNT_SESSION_EXPIRED' === $service->last_code() );
	$missing = $service->create( new WP_User( 99 ), false, null, null, $now );
	$assert( null === $service->resolve( $missing['token'], $now + 1 ) );
	$assert( 'ACCOUNT_SESSION_USER_INVALID' === $service->last_code() );
	$assert( null === $service->resolve( 'malformed', $now ) );
	$assert( 'ACCOUNT_SESSION_HASH_MISMATCH' === $service->last_code() );

	$failed_db = new FakeWpdb();
	$failed_db->fail_session_insert = true;
	$failed_service = new SessionService(
		new SessionRepository( $failed_db ),
		new SessionToken()
	);
	$assert( null === $failed_service->create( $user, false, null, null, $now ) );
	$assert( 'ACCOUNT_SESSION_INSERT_FAILED' === $failed_service->last_code() );
} );

$test( 'payload Google é fechado, verificado e aceita somente provider google', static function () use ( $assert, $throws ): void {
	$validator = new GoogleLoginPayloadValidator();
	$payload = array(
		'provider' => 'google',
		'subject' => 'google-subject-1',
		'email' => 'google@example.test',
		'emailVerified' => true,
		'firstName' => 'Google',
		'lastName' => 'Cliente',
		'displayName' => 'Google Cliente',
		'picture' => 'https://example.test/avatar.jpg',
	);
	$validated = $validator->validate( (string) json_encode( $payload ) );
	$assert( 'google' === $validated['provider'] );
	$assert( true === $validated['email_verified'] );
	$without_picture = $payload;
	unset( $without_picture['picture'] );
	$assert( '' === $validator->validate( (string) json_encode( $without_picture ) )['picture'] );
	foreach ( array(
		array_merge( $payload, array( 'provider' => 'facebook' ) ),
		array_merge( $payload, array( 'emailVerified' => false ) ),
		array_merge( $payload, array( 'subject' => '' ) ),
		array_merge( $payload, array( 'accessToken' => 'forbidden' ) ),
	) as $invalid ) {
		$throws(
			static fn() => $validator->validate( (string) json_encode( $invalid ) ),
			ValidationException::class
		);
	}
} );

$test( 'Google vincula cliente, reutiliza subject e bloqueia papel privilegiado', static function () use ( $assert ): void {
	$GLOBALS['test_users'] = array();
	$GLOBALS['inserted_users'] = array();
	$db = new FakeWpdb();
	$service = new GoogleIdentityService(
		new IdentityRepository( $db ),
		PERSI_HEADLESS_ACCOUNT_HMAC_SECRET
	);
	$identity = array(
		'subject' => 'google-subject-1',
		'email' => 'novo@example.test',
		'first_name' => 'Novo',
		'last_name' => 'Cliente',
		'display_name' => 'Novo Cliente',
	);
	$created = $service->resolve( $identity, 1800000000 );
	$assert( $created instanceof WP_User );
	$assert( in_array( 'customer', $created->roles, true ) );
	$assert( 1 === count( $db->identities ) );
	$assert( ! isset( $db->identities[0]['subject'] ) );
	$assert( 64 === strlen( $db->identities[0]['provider_subject_hash'] ) );

	$linked = $service->resolve(
		array_merge( $identity, array( 'email' => 'alterado@example.test' ) ),
		1800000060
	);
	$assert( $linked instanceof WP_User && $linked->ID === $created->ID );
	$assert( 1 === count( $db->identities ) );

	$admin = new WP_User( 50, array( 'administrator' ), 'admin@example.test' );
	$GLOBALS['test_users'][50] = $admin;
	$blocked = $service->resolve(
		array_merge(
			$identity,
			array( 'subject' => 'google-admin', 'email' => 'admin@example.test' )
		),
		1800000120
	);
	$assert( null === $blocked );
	$assert( 'ACCOUNT_GOOGLE_USER_REJECTED' === $service->last_code() );

	unset( $GLOBALS['test_users'][ $created->ID ] );
	$deleted = $service->resolve( $identity, 1800000180 );
	$assert( null === $deleted );
	$assert( 'ACCOUNT_GOOGLE_USER_REJECTED' === $service->last_code() );
} );

$test( 'Google vincula e-mail verificado existente e impede identidade duplicada', static function () use ( $assert ): void {
	$GLOBALS['test_users'] = array();
	$GLOBALS['inserted_users'] = array();
	$existing = new WP_User( 70, array( 'customer' ), 'existente@example.test' );
	$GLOBALS['test_users'][70] = $existing;
	$db = new FakeWpdb();
	$service = new GoogleIdentityService(
		new IdentityRepository( $db ),
		PERSI_HEADLESS_ACCOUNT_HMAC_SECRET
	);
	$identity = array(
		'subject' => 'google-existing',
		'email' => 'existente@example.test',
		'first_name' => 'Cliente',
		'last_name' => 'Existente',
		'display_name' => 'Cliente Existente',
	);
	$linked = $service->resolve( $identity, 1800000000 );
	$assert( $linked instanceof WP_User && 70 === $linked->ID );
	$assert( 1 === count( $db->identities ) );

	$duplicate = $service->resolve(
		array_merge( $identity, array( 'subject' => 'google-other-subject' ) ),
		1800000060
	);
	$assert( null === $duplicate );
	$assert( 'ACCOUNT_GOOGLE_LINK_CREATE_FAILED' === $service->last_code() );
	$assert( 1 === count( $db->identities ) );
} );

$test( 'rate limit aplica Retry-After, expira e pode ser limpo', static function () use ( $assert ): void {
	$db = new FakeWpdb();
	$limiter = new RateLimiter( $db );
	$bucket = hash( 'sha256', 'bucket' );
	$now = 1800000000;
	for ( $attempt = 1; $attempt <= Configuration::LOGIN_MAX_ATTEMPTS; $attempt++ ) {
		$retry = $limiter->record_failure( $bucket, $now );
	}
	$assert( $retry > 0 );
	$assert( $limiter->retry_after( array( $bucket ), $now ) === $retry );
	$assert( 0 === $limiter->retry_after( array( $bucket ), $now + $retry + 1 ) );
	$limiter->clear( array( $bucket ) );
	$assert( 0 === $limiter->retry_after( array( $bucket ), $now ) );
} );

$test( 'fontes não expõem customerId nem registram dados sensíveis', static function () use ( $root, $assert ): void {
	$controller = file_get_contents( $root . '/src/Api/AuthController.php' );
	$logger = file_get_contents( $root . '/src/Support/Logger.php' );
	$schema = file_get_contents( $root . '/src/Activator.php' );
	$repository = file_get_contents( $root . '/src/Auth/SessionRepository.php' );
	$token = file_get_contents( $root . '/src/Auth/SessionToken.php' );
	$google_controller = file_get_contents( $root . '/src/Api/GoogleAuthController.php' );
	$identity_repository = file_get_contents( $root . '/src/Auth/IdentityRepository.php' );
	$assert( ! str_contains( $controller, "'customerId'" ) );
	$assert( ! str_contains( $controller, "'code' =>" ) );
	$assert( ! str_contains( $controller, "'code'    =>" ) );
	$assert( ! str_contains( $logger, 'password' ) );
	foreach ( array( 'email', 'token', 'cookie', 'secret', 'signature', 'nonce', 'payload' ) as $sensitive ) {
		$assert( ! str_contains( $logger, "'{$sensitive}'" ) );
	}
	$assert( str_contains( $schema, 'UNIQUE KEY token_hash' ) );
	foreach ( array( 'persi_account_sessions', 'persi_account_nonces', 'persi_account_rate_limits' ) as $table ) {
		$assert( str_contains( $schema, $table ) );
	}
	$assert( str_contains( $repository, "\$database->prefix . 'persi_account_sessions'" ) );
	$assert( str_contains( $repository, 'WHERE token_hash = %s' ) );
	$assert( str_contains( $token, "hash( 'sha256', \$token )" ) );
	$assert( str_contains( $google_controller, 'RequestAuthenticator' ) );
	$assert( str_contains( $google_controller, "'sessionToken'" ) );
	$assert( ! str_contains( $google_controller, "'customerId'" ) );
	foreach ( array( 'access_token', 'refresh_token', 'id_token', 'client_secret' ) as $forbidden ) {
		$assert( ! str_contains( $google_controller, $forbidden ) );
		$assert( ! str_contains( $identity_repository, $forbidden ) );
	}
	$assert( str_contains( $schema, 'UNIQUE KEY provider_subject' ) );
	$assert( str_contains( $schema, 'UNIQUE KEY provider_email' ) );
	$assert( ! str_contains( $schema, 'password' ) );
	$assert( ! str_contains( $schema, 'email' ) );
} );

$test( 'pedidos usam CRUD HPOS, contrato fechado e autorização por propriedade', static function () use ( $root, $assert ): void {
	$controller = file_get_contents( $root . '/src/Api/OrderController.php' );
	$service = file_get_contents( $root . '/src/Orders/OrderService.php' );
	$presenter = file_get_contents( $root . '/src/Orders/OrderPresenter.php' );
	$assert( str_contains( $service, 'wc_get_orders' ) );
	$assert( str_contains( $service, 'wc_get_order' ) );
	$assert( ! str_contains( $service, 'get_posts' ) );
	$assert( ! str_contains( $service, 'postmeta' ) );
	$assert( str_contains( $service, 'get_customer_id()' ) );
	$assert( str_contains( $controller, "array( 'page', 'per_page', 'status' )" ) );
	$assert( str_contains( $controller, 'Pedido não encontrado.' ) );
	foreach ( array( 'customer_id', 'transaction_id', 'meta_data' ) as $sensitive ) {
		$assert( ! str_contains( $presenter, "'{$sensitive}'" ) );
	}
	$assert( OrderPresenter::allowed_statuses() === array(
		'pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed',
	) );
} );

$test( 'cadastro e recuperação usam APIs nativas e resposta sem enumeração', static function () use ( $root, $assert ): void {
	$controller = file_get_contents( $root . '/src/Api/AccountAccessController.php' );
	$validator = file_get_contents( $root . '/src/Validation/AccountAccessPayloadValidator.php' );
	$assert( str_contains( $controller, 'wp_insert_user' ) );
	$assert( str_contains( $controller, "'user_pass' => \$input['password']" ) );
	$assert( str_contains( $controller, "'user_email' => \$input['email']" ) );
	$assert( str_contains( $controller, "'user_login' => \$username" ) );
	$assert( str_contains( $controller, "'role' => 'customer'" ) );
	$assert( str_contains( $controller, 'retrieve_password' ) );
	$assert( str_contains( $controller, 'check_password_reset_key' ) );
	$assert( str_contains( $controller, 'reset_password' ) );
	$assert( str_contains( $controller, 'Se existir uma conta com este e-mail' ) );
	$assert( str_contains( $controller, 'RateLimiter' ) );
	$assert( str_contains( $validator, 'array_diff' ) );
	$assert( ! str_contains( $controller, "'user_id' =>" ) );
	$assert( ! str_contains( $controller, "'customer_id' =>" ) );
} );

$test( 'cadastro aceita CPF e telefone opcionais e valida campos obrigatórios', static function () use ( $assert, $throws ): void {
	$validator = new AccountAccessPayloadValidator();
	$base = array(
		'name' => 'Ana Cliente',
		'email' => 'ana@example.test',
		'password' => '12345678',
		'passwordConfirmation' => '12345678',
		'acceptTerms' => true,
	);
	$without_optionals = $validator->register( (string) json_encode( $base ) );
	$assert( '' === $without_optionals['phone'] && '' === $without_optionals['cpf'] );

	foreach ( array( '', '1133334444', '11999998888' ) as $phone ) {
		$value = $validator->register( (string) json_encode( array_merge( $base, array( 'phone' => $phone, 'cpf' => '' ) ) ) );
		$assert( $phone === $value['phone'] );
	}

	foreach ( array(
		array_merge( $base, array( 'password' => '1234567', 'passwordConfirmation' => '1234567' ) ),
		array_merge( $base, array( 'passwordConfirmation' => '87654321' ) ),
		array_merge( $base, array( 'acceptTerms' => false ) ),
		array_merge( $base, array( 'role' => 'administrator' ) ),
	) as $invalid ) {
		$throws(
			static fn() => $validator->register( (string) json_encode( $invalid ) ),
			ValidationException::class
		);
	}
} );

$failures = 0;
foreach ( $tests as [ $name, $callback ] ) {
	try {
		$callback();
		echo "PASS {$name}\n";
	} catch ( Throwable $error ) {
		++$failures;
		echo "FAIL {$name}: {$error->getMessage()}\n";
	}
}

echo sprintf( "\n%d tests, %d failures\n", count( $tests ), $failures );
exit( $failures > 0 ? 1 : 0 );
