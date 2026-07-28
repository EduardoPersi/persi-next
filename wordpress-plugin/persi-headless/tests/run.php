<?php
declare(strict_types=1);
$root = dirname( __DIR__ );
$files = array(
	'module' => file_get_contents( $root . '/includes/stock-notifications/class-stock-notifications.php' ),
	'repository' => file_get_contents( $root . '/includes/stock-notifications/class-repository.php' ),
	'auth' => file_get_contents( $root . '/includes/stock-notifications/class-authenticator.php' ),
	'validator' => file_get_contents( $root . '/includes/stock-notifications/class-validator.php' ),
);
$checks = array(
	'HMAC usa hash_equals' => str_contains( $files['auth'], 'hash_equals' ),
	'Key ID case-insensitive' => str_contains( $files['auth'], 'strtolower( $key_id )' ),
	'replay usa INSERT IGNORE' => str_contains( $files['repository'], 'INSERT IGNORE' ),
	'payload fechado' => str_contains( $files['validator'], 'array_diff' ),
	'consentimento persistido' => str_contains( $files['module'], "'consent_given' => 1" ),
	'sem e-mail em log' => ! str_contains( $files['module'], 'error_log' ),
	'transição real' => str_contains( $files['module'], "'outofstock' !== $previous" ),
	'claim coordenado' => str_contains( $files['module'], "status='sending'" ),
	'revalida estoque' => str_contains( $files['module'], '! $product->is_in_stock()' ),
	'três tentativas' => str_contains( $files['module'], 'attempts<3' ),
	'anonimização remove e-mail' => str_contains( $files['repository'], "email_encrypted=''" ),
	'template escapa conteúdo' => str_contains( $files['module'], 'esc_html( $product->get_name() )' ),
);
$failures = 0;
foreach ( $checks as $name => $passed ) { echo ( $passed ? 'PASS ' : 'FAIL ' ) . $name . "\n"; if ( ! $passed ) ++$failures; }
exit( $failures ? 1 : 0 );
