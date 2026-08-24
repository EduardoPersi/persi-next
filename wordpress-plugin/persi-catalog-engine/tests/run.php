<?php
declare(strict_types=1);

define( 'ABSPATH', __DIR__ . '/' );

class WP_Error {
	public function __construct( private string $code ) {}
	public function get_error_code(): string { return $this->code; }
	public function get_error_data(): array { return array(); }
}
function is_wp_error( $value ): bool { return $value instanceof WP_Error; }

class WC_Product {
	public bool $saved = false;
	public function __construct( private int $id, private string $sku, private string $gtin = '' ) {}
	public function get_id(): int { return $this->id; }
	public function get_sku(): string { return $this->sku; }
	public function get_global_unique_id(): string { return $this->gtin; }
	public function set_global_unique_id( string $gtin ): void { $this->gtin = $gtin; }
	public function save(): void { $this->saved = true; }
}

require_once dirname( __DIR__ ) . '/src/Support/Statuses.php';
require_once dirname( __DIR__ ) . '/src/Catalog/GtinValidator.php';
require_once dirname( __DIR__ ) . '/src/Catalog/ProductMatcher.php';
require_once dirname( __DIR__ ) . '/src/Catalog/GtinSync.php';

use Persi\CatalogEngine\Catalog\GtinSync;
use Persi\CatalogEngine\Catalog\GtinValidator;
use Persi\CatalogEngine\Catalog\ProductMatcher;
use Persi\CatalogEngine\Support\Statuses;

class FakeMatcher extends ProductMatcher {
	public function __construct( private array $result ) {}
	public function match( string $sku ): array { return $this->result; }
}

function sync_with( WC_Product $product, array $match, bool $dry = false ): array {
	return ( new GtinSync( new FakeMatcher( $match ), new GtinValidator() ) )->process( $product, $dry );
}

$valid = '7891234567895';
$tests = array();
$tests['GTIN-8 válido'] = ( new GtinValidator() )->is_valid( '12345670' );
$tests['GTIN-12 válido'] = ( new GtinValidator() )->is_valid( '036000291452' );
$tests['GTIN-13 válido'] = ( new GtinValidator() )->is_valid( $valid );
$tests['GTIN-14 e zero inicial preservado'] = ( new GtinValidator() )->normalize( '07891234567895' ) === '07891234567895' && ( new GtinValidator() )->is_valid( '07891234567895' );
$tests['GTIN inválido recusado'] = ! ( new GtinValidator() )->is_valid( '7891234567890' );

$product = new WC_Product( 1, 'A' );
$result = sync_with( $product, array( 'status' => 'MATCHED', 'product' => array( 'id' => 10, 'sku' => 'A', 'gtin' => $valid ) ) );
$tests['Caso A UPDATED'] = Statuses::UPDATED === $result['status'] && $product->saved;
$tests['Caso B ALREADY_SYNCED'] = Statuses::ALREADY_SYNCED === sync_with( new WC_Product( 2, 'B', $valid ), array( 'status' => 'MATCHED', 'product' => array( 'id' => 11, 'sku' => 'B', 'gtin' => $valid ) ) )['status'];
$conflict = new WC_Product( 3, 'C', '036000291452' );
$tests['Caso C GTIN_CONFLICT sem escrita'] = Statuses::GTIN_CONFLICT === sync_with( $conflict, array( 'status' => 'MATCHED', 'product' => array( 'id' => 12, 'sku' => 'C', 'gtin' => $valid ) ) )['status'] && ! $conflict->saved;
$tests['Caso D NO_SKU'] = Statuses::NO_SKU === sync_with( new WC_Product( 4, '' ), array() )['status'];
$tests['Caso E OLIST_NOT_FOUND'] = Statuses::OLIST_NOT_FOUND === sync_with( new WC_Product( 5, 'E' ), array( 'status' => Statuses::OLIST_NOT_FOUND ) )['status'];
$tests['Caso F OLIST_NO_GTIN'] = Statuses::OLIST_NO_GTIN === sync_with( new WC_Product( 6, 'F' ), array( 'status' => 'MATCHED', 'product' => array( 'id' => 13, 'sku' => 'F', 'gtin' => '' ) ) )['status'];
$tests['Caso G INVALID_GTIN'] = Statuses::INVALID_GTIN === sync_with( new WC_Product( 7, 'G' ), array( 'status' => 'MATCHED', 'product' => array( 'id' => 14, 'sku' => 'G', 'gtin' => '123' ) ) )['status'];
$zero = new WC_Product( 8, 'H' );
$tests['Caso H zero inicial salvo'] = Statuses::UPDATED === sync_with( $zero, array( 'status' => 'MATCHED', 'product' => array( 'id' => 15, 'sku' => 'H', 'gtin' => '07891234567895' ) ) )['status'] && '07891234567895' === $zero->get_global_unique_id();
$variation_a = new WC_Product( 9, 'V-A');
$variation_b = new WC_Product( 10, 'V-B');
sync_with( $variation_a, array( 'status' => 'MATCHED', 'product' => array( 'id' => 16, 'sku' => 'V-A', 'gtin' => $valid ) ) );
sync_with( $variation_b, array( 'status' => 'MATCHED', 'product' => array( 'id' => 17, 'sku' => 'V-B', 'gtin' => '036000291452' ) ) );
$tests['Caso I variações independentes'] = $variation_a->get_global_unique_id() !== $variation_b->get_global_unique_id();
$tests['Caso J API_ERROR sem escrita'] = Statuses::API_ERROR === sync_with( new WC_Product( 11, 'J' ), array( 'status' => Statuses::API_ERROR, 'error' => new WP_Error( 'timeout' ) ) )['status'];
$dry = new WC_Product( 12, 'K' );
$tests['Caso K Dry Run sem escrita'] = Statuses::WOULD_UPDATE === sync_with( $dry, array( 'status' => 'MATCHED', 'product' => array( 'id' => 18, 'sku' => 'K', 'gtin' => $valid ) ), true )['status'] && ! $dry->saved && '' === $dry->get_global_unique_id();

$failures = 0;
foreach ( $tests as $name => $passed ) {
	echo ( $passed ? 'PASS ' : 'FAIL ' ) . $name . PHP_EOL;
	if ( ! $passed ) { ++$failures; }
}
exit( $failures > 0 ? 1 : 0 );
