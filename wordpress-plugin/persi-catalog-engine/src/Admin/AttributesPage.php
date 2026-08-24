<?php

namespace Persi\CatalogEngine\Admin;

use Persi\CatalogEngine\Attributes\CanonicalDictionary;
use Persi\CatalogEngine\Attributes\AttributeDestinationResolver;
use Persi\CatalogEngine\Infrastructure\AttributeCandidateRepository;
use Persi\CatalogEngine\Infrastructure\AttributeMappingRepository;

defined( 'ABSPATH' ) || exit;

final class AttributesPage {
	public function register(): void {
		add_action( 'admin_menu', array( $this, 'menu' ), 62 );
		add_action( 'admin_enqueue_scripts', array( $this, 'assets' ) );
	}

	public function assets( string $hook ): void { if ( 'woocommerce_page_persi-catalog-attributes' === $hook ) { wp_enqueue_style( 'persi-catalog-admin', plugins_url( 'assets/admin.css', PERSI_CATALOG_ENGINE_FILE ), array(), PERSI_CATALOG_ENGINE_VERSION ); } }

	public function menu(): void {
		add_submenu_page( 'woocommerce', 'Atributos Persi', 'Atributos', 'manage_woocommerce', 'persi-catalog-attributes', array( $this, 'render' ) );
	}

	public function render(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Acesso negado.', 'persi-catalog-engine' ) );
		}
		$mapping_notice = '';
		if ( 'POST' === ( $_SERVER['REQUEST_METHOD'] ?? '' ) && isset( $_POST['persi_mapping'] ) ) {
			check_admin_referer( 'persi_attribute_mapping' );
			$origin = sanitize_text_field( wp_unslash( $_POST['origin_key'] ?? '' ) );
			$key = sanitize_key( wp_unslash( $_POST['attribute_key'] ?? '' ) );
			$taxonomy = sanitize_key( wp_unslash( $_POST['woo_taxonomy'] ?? '' ) );
			$normalizer = sanitize_key( wp_unslash( $_POST['normalizer'] ?? '' ) );
			$family = sanitize_key( wp_unslash( $_POST['family'] ?? '' ) );
			if ( ! $origin || ! $key || ! taxonomy_exists( $taxonomy ) || 0 !== strpos( $taxonomy, 'pa_' ) ) {
				$mapping_notice = 'Mapeamento recusado: selecione uma taxonomia global WooCommerce existente.';
			} else {
				$saved = ( new AttributeMappingRepository() )->save( $origin, absint( $_POST['category_id'] ?? 0 ), $key, $taxonomy, $normalizer, get_current_user_id(), $family );
				$mapping_notice = $saved ? 'Mapeamento salvo. Ele afeta somente propostas futuras; não escreve produtos.' : 'Não foi possível salvar o mapeamento.';
			}
		}
		$attributes = $this->inventory();
		$mappings   = ( new AttributeMappingRepository() )->all();
		$run_id     = absint( $_GET['run_id'] ?? get_option( 'persi_catalog_last_run_id', 0 ) );
		$filters = array(); foreach ( array( 'status', 'attribute_key', 'source', 'confidence', 'family' ) as $filter_key ) { $filters[ $filter_key ] = sanitize_text_field( wp_unslash( $_GET[ $filter_key ] ?? '' ) ); } $filters['hide_synced'] = ! isset( $_GET['show_synced'] ); $filters['hide_rejected'] = ! isset( $_GET['show_rejected'] );
		$automatic_mappings = ( new AttributeDestinationResolver() )->automatic_rules();
		$candidate_repository = new AttributeCandidateRepository();
		$candidates = $run_id ? $candidate_repository->for_run( $run_id, 500, $filters ) : array();
		$coverage   = $run_id ? $candidate_repository->coverage( $run_id ) : array();
		$summary    = $run_id ? $candidate_repository->summary( $run_id ) : array();
		$filter_values = $run_id ? $candidate_repository->filter_values( $run_id ) : array();
		include PERSI_CATALOG_ENGINE_PATH . 'templates/admin/attributes.php';
	}

	private function inventory(): array {
		global $wpdb;
		$rows = array();
		foreach ( wc_get_attribute_taxonomies() as $attribute ) {
			$taxonomy  = wc_attribute_taxonomy_name( $attribute->attribute_name );
			$term_data = wp_count_terms( array( 'taxonomy' => $taxonomy, 'hide_empty' => false ) );
			$usage     = $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(DISTINCT relationships.object_id) FROM {$wpdb->term_relationships} relationships INNER JOIN {$wpdb->term_taxonomy} taxonomy ON taxonomy.term_taxonomy_id=relationships.term_taxonomy_id WHERE taxonomy.taxonomy=%s", $taxonomy ) );
			$rows[]    = array( 'name' => $attribute->attribute_label, 'taxonomy' => $taxonomy, 'terms' => is_wp_error( $term_data ) ? 0 : absint( $term_data ), 'products' => absint( $usage ), 'canonical' => CanonicalDictionary::suggest_key( $attribute->attribute_label ) );
		}
		$counts = array_count_values( array_filter( array_column( $rows, 'canonical' ) ) );
		foreach ( $rows as &$row ) { $row['duplicate'] = $row['canonical'] && ( $counts[ $row['canonical'] ] ?? 0 ) > 1; }
		return $rows;
	}
}
