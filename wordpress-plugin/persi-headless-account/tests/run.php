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

function get_user_by( string $field, int $id ) {
	return $GLOBALS['test_users'][ $id ] ?? false;
}

function wp_authenticate( string $identifier, string $password ) {
	return $GLOBALS['auth_result'] ?? new WP_Error();
}

function is_wp_error( $value ): bool {
	return $value instanceof WP_Error;
}

final class FakeWpdb {
	public string $prefix = 'wp_';
	public array $sessions = array();
	public array $nonces = array();
	public array $limits = array();
	private int $next_id = 1;

	public function prepare( string $query, ...$args ): array {
		return array( $query, $args );
	}

	public function insert( string $table, array $data, array $formats ) {
		if ( str_contains( $table, 'sessions' ) ) {
			foreach ( $this->sessions as $row ) {
				if ( $row['token_hash'] === $data['token_hash'] ) {
					return false;
				}
			}
			$data['id'] = $this->next_id++;
			$this->sessions[] = $data;
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
					$row['last_seen_at'] = $args[0];
					$row['idle_expires_at'] = min( $row['absolute_expires_at'], $args[1] );
					return 1;
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
		foreach ( $this->sessions as $row ) {
			if ( $row['token_hash'] === $args[0] && 'active' === $row['status'] ) {
				return $row;
			}
		}
		return null;
	}

	public function get_var( $statement ) {
		[ , $args ] = $statement;
		return $this->limits[ $args[0] ]['blocked_until'] ?? null;
	}

	public function update( string $table, array $data, array $where ) {
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
$load( 'Validation/ValidationException.php' );
$load( 'Validation/LoginPayloadValidator.php' );
$load( 'Validation/AccountAccessPayloadValidator.php' );
$load( 'Orders/OrderPresenter.php' );
$load( 'Orders/OrderService.php' );

use Persi\HeadlessAccount\Auth\CredentialsAuthenticator;
use Persi\HeadlessAccount\Auth\SessionRepository;
use Persi\HeadlessAccount\Auth\SessionService;
use Persi\HeadlessAccount\Auth\SessionToken;
use Persi\HeadlessAccount\Security\AuthenticationException;
use Persi\HeadlessAccount\Security\NonceRepository;
use Persi\HeadlessAccount\Security\RateLimiter;
use Persi\HeadlessAccount\Security\RequestAuthenticator;
use Persi\HeadlessAccount\Support\Configuration;
use Persi\HeadlessAccount\Support\OriginNormalizer;
use Persi\HeadlessAccount\Validation\LoginPayloadValidator;
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
	$GLOBALS['auth_result'] = new WP_Error();
	$assert( null === $authenticator->authenticate( 'missing', 'invalid' ) );
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
	$assert( ! isset( $db->sessions[0]['token'] ) );
	$assert( $db->sessions[0]['token_hash'] === hash( 'sha256', $created['token'] ) );
	$resolved = $service->resolve( $created['token'], $now + 60 );
	$assert( is_array( $resolved ) && 10 === $resolved['user']->ID );
	$service->logout( $created['token'], $now + 61 );
	$assert( null === $service->resolve( $created['token'], $now + 62 ) );
	$service->logout( $created['token'], $now + 63 );

	$expired = $service->create( $user, false, null, null, $now );
	$assert( null === $service->resolve( $expired['token'], $now + Configuration::IDLE_SECONDS + 1 ) );
	$absolute = $service->create( $user, true, null, null, $now );
	$assert( null === $service->resolve( $absolute['token'], $now + Configuration::REMEMBER_ABSOLUTE_SECONDS + 1 ) );
	$missing = $service->create( new WP_User( 99 ), false, null, null, $now );
	$assert( null === $service->resolve( $missing['token'], $now + 1 ) );
	$assert( null === $service->resolve( 'malformed', $now ) );
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
	$assert( ! str_contains( $controller, "'customerId'" ) );
	$assert( ! str_contains( $logger, 'password' ) );
	$assert( str_contains( $schema, 'UNIQUE KEY token_hash' ) );
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
