<?php

declare(strict_types=1);

define( 'ABSPATH', __DIR__ . '/' );
define( 'PERSI_HEADLESS_CHECKOUT_HMAC_KEY_ID', 'primary' );

require_once dirname( __DIR__ ) . '/src/Security/AuthenticationException.php';
require_once dirname( __DIR__ ) . '/src/Security/AuthenticationResult.php';
require_once dirname( __DIR__ ) . '/src/Security/RequestAuthenticator.php';
require_once dirname( __DIR__ ) . '/src/Checkout/TransferRepository.php';
require_once dirname( __DIR__ ) . '/src/Compatibility/SmartCheckout.php';

use Persi\HeadlessCheckout\Checkout\TransferRepository;
use Persi\HeadlessCheckout\Compatibility\SmartCheckout;
use Persi\HeadlessCheckout\Security\AuthenticationException;
use Persi\HeadlessCheckout\Security\RequestAuthenticator;

$passed = 0;
$failed = 0;

$assert = static function ( bool $condition, string $message = 'Assertion failed.' ): void {
	if ( ! $condition ) {
		throw new RuntimeException( $message );
	}
};

$throws = static function ( callable $callback, string $class ) use ( $assert ): void {
	try {
		$callback();
	} catch ( Throwable $exception ) {
		$assert( $exception instanceof $class, 'Unexpected exception: ' . get_class( $exception ) );
		return;
	}

	throw new RuntimeException( 'Expected exception was not thrown.' );
};

$test = static function ( string $name, callable $callback ) use ( &$passed, &$failed ): void {
	try {
		$callback();
		++$passed;
		echo "PASS: {$name}\n";
	} catch ( Throwable $exception ) {
		++$failed;
		echo "FAIL: {$name}: {$exception->getMessage()}\n";
	}
};

$request = static function (
	string $key_id,
	string $secret,
	int $timestamp,
	string $nonce,
	string $body,
	?string $signing_secret = null,
	?string $signature = null
): array {
	$origin = 'https://frontend.test';
	$canonical = RequestAuthenticator::canonical_request(
		(string) $timestamp,
		$nonce,
		$origin,
		$body
	);

	return array(
		'headers' => array(
			'x-persi-key-id' => $key_id,
			'x-persi-timestamp' => (string) $timestamp,
			'x-persi-nonce' => $nonce,
			'x-persi-origin' => $origin,
			'x-persi-signature' => $signature ?? 'v1=' . hash_hmac( 'sha256', $canonical, $signing_secret ?? $secret ),
		),
		'body' => $body,
	);
};

$test( 'Key ID aceita qualquer combinação de maiúsculas e minúsculas', static function () use ( $assert, $request ): void {
	$authenticator = new RequestAuthenticator();
	$secret = 'test-secret-placeholder-not-real';
	$now = 1800000000;
	$body = '{"items":[{"productId":1,"quantity":1}]}';

	foreach ( array( 'primary', 'PRIMARY', 'Primary', 'PrImArY' ) as $index => $key_id ) {
		$prepared = $request( $key_id, $secret, $now, 'caseinsensitivekeyid0' . $index, $body );
		$result = $authenticator->authenticate(
			$prepared['headers'],
			$prepared['body'],
			$now,
			$secret,
			array( 'https://frontend.test' )
		);
		$assert( $key_id === $result->key_id );
	}
} );

$test( 'Key ID diferente é rejeitado', static function () use ( $request, $throws ): void {
	$authenticator = new RequestAuthenticator();
	$secret = 'test-secret-placeholder-not-real';
	$now = 1800000000;
	$prepared = $request( 'keyid2', $secret, $now, 'differentkeyidnonce000', '{}' );

	$throws(
		static function () use ( $authenticator, $prepared, $now, $secret ): void {
			$authenticator->authenticate( $prepared['headers'], $prepared['body'], $now, $secret, array( 'https://frontend.test' ) );
		},
		AuthenticationException::class
	);
} );

$test( 'segredo e assinatura incorretos continuam rejeitados', static function () use ( $request, $throws ): void {
	$authenticator = new RequestAuthenticator();
	$secret = 'test-secret-placeholder-not-real';
	$now = 1800000000;
	$wrong_secret = $request( 'primary', $secret, $now, 'wrongsecretnoncevalue00', '{}', 'incorrect-secret' );
	$wrong_signature = $request(
		'primary',
		$secret,
		$now,
		'wrongsignaturenonce000',
		'{}',
		null,
		'v1=' . str_repeat( '0', 64 )
	);

	foreach ( array( $wrong_secret, $wrong_signature ) as $prepared ) {
		$throws(
			static function () use ( $authenticator, $prepared, $now, $secret ): void {
				$authenticator->authenticate( $prepared['headers'], $prepared['body'], $now, $secret, array( 'https://frontend.test' ) );
			},
			AuthenticationException::class
		);
	}
} );

$test( 'timestamp expirado continua rejeitado', static function () use ( $request, $throws ): void {
	$authenticator = new RequestAuthenticator();
	$secret = 'test-secret-placeholder-not-real';
	$timestamp = 1800000000;
	$prepared = $request( 'primary', $secret, $timestamp, 'expiredtimestampnonce0', '{}' );

	$throws(
		static function () use ( $authenticator, $prepared, $timestamp, $secret ): void {
			$authenticator->authenticate(
				$prepared['headers'],
				$prepared['body'],
				$timestamp + RequestAuthenticator::MAX_CLOCK_SKEW + 1,
				$secret,
				array( 'https://frontend.test' )
			);
		},
		AuthenticationException::class
	);
} );

final class FakeTransferDatabase {
	public string $prefix = 'wp_';
	private array $nonces = array();

	public function insert( string $table, array $record, array $formats ) {
		if ( isset( $this->nonces[ $record['request_nonce_hash'] ] ) ) {
			return false;
		}

		$this->nonces[ $record['request_nonce_hash'] ] = true;
		return 1;
	}

	public function prepare( string $query, ...$arguments ): array {
		return array( $query, $arguments );
	}

	public function get_var( array $statement ) {
		$nonce_hash = $statement[1][0] ?? '';
		return isset( $this->nonces[ $nonce_hash ] ) ? 1 : null;
	}
}

$test( 'nonce repetido continua rejeitado pelo repositório', static function () use ( $assert ): void {
	$repository = new TransferRepository( new FakeTransferDatabase() );
	$record = array(
		'token_hash' => str_repeat( 'a', 64 ),
		'request_nonce_hash' => str_repeat( 'b', 64 ),
		'payload_hash' => str_repeat( 'c', 64 ),
		'payload' => '{}',
		'key_id' => 'primary',
		'expires_at' => '2027-01-15 08:05:00',
		'created_at' => '2027-01-15 08:00:00',
	);

	$assert( 'created' === $repository->create( $record ) );
	$assert( 'replay' === $repository->create( $record ) );
} );

$test( 'compatibilidade do Smart Checkout é limitada ao backend e ao checkout', static function () use ( $assert ): void {
	$assert( SmartCheckout::should_inject( 'loja.persimateriais.com.br', true ) );
	$assert( SmartCheckout::should_inject( 'LOJA.PERSIMATERIAIS.COM.BR.', true ) );
	$assert( ! SmartCheckout::should_inject( 'persimateriais.com.br', true ) );
	$assert( ! SmartCheckout::should_inject( 'loja.persimateriais.com.br', false ) );
} );

$test( 'adaptador restaura Array.includes e não remove loading por CSS', static function () use ( $assert ): void {
	$script = SmartCheckout::inline_script();
	$source = file_get_contents( dirname( __DIR__ ) . '/src/Compatibility/SmartCheckout.php' );

	$assert( false !== strpos( $script, 'loja.persimateriais.com.br' ) );
	$assert( false !== strpos( $script, 'Array.prototype.includes = originalIncludes' ) );
	$assert( false === strpos( $script, 'smart-checkout-loading' ) );
	$assert( false === strpos( $script, 'updated_checkout' ) );
	$assert( false !== strpos( $source, "add_action( 'wc_smart_checkout_scripts'" ) );
	$assert( false === strpos( $source, "add_action( 'wp_enqueue_scripts'" ) );
} );

echo "\n{$passed} passed, {$failed} failed.\n";
exit( 0 === $failed ? 0 : 1 );
