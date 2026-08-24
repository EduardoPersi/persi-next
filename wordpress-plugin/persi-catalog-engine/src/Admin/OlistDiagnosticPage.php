<?php

namespace Persi\CatalogEngine\Admin;

use Persi\CatalogEngine\Api\OlistClient;
use Persi\CatalogEngine\Catalog\ProductMatcher;
use Persi\CatalogEngine\Support\PayloadSanitizer;

defined( 'ABSPATH' ) || exit;

final class OlistDiagnosticPage {
	public function register(): void {
		add_action( 'admin_menu', array( $this, 'menu' ), 61 );
	}

	public function menu(): void {
		add_submenu_page( 'woocommerce', 'Diagnóstico Olist', 'Diagnóstico Olist', 'manage_woocommerce', 'persi-catalog-olist-diagnostic', array( $this, 'render' ) );
	}

	public function render(): void {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( esc_html__( 'Acesso negado.', 'persi-catalog-engine' ) );
		}
		$result = null;
		$error  = '';
		if ( 'POST' === ( $_SERVER['REQUEST_METHOD'] ?? '' ) ) {
			check_admin_referer( 'persi_olist_diagnostic' );
			$product_id = absint( $_POST['product_id'] ?? 0 );
			$sku        = isset( $_POST['sku'] ) ? sanitize_text_field( wp_unslash( $_POST['sku'] ) ) : '';
			$product    = $product_id ? wc_get_product( $product_id ) : null;
			if ( $product ) {
				$sku = trim( (string) $product->get_sku() );
			}
			if ( '' === $sku ) {
				$error = 'Informe um ID WooCommerce válido ou um SKU.';
			} else {
				$match = ( new ProductMatcher() )->match( $sku );
				if ( 'MATCHED' !== ( $match['status'] ?? '' ) ) {
					$error = 'Correspondência Olist: ' . sanitize_text_field( (string) ( $match['status'] ?? 'ERRO' ) );
				} else {
					$detail = ( new OlistClient() )->product_detail( absint( $match['product']['id'] ?? 0 ) );
					if ( is_wp_error( $detail ) ) {
						$error = $detail->get_error_message();
					} else {
						$sanitizer = new PayloadSanitizer();
						$payload   = $sanitizer->sanitize( $detail );
						$result    = array( 'product' => $product, 'sku' => $sku, 'olist_id' => absint( $match['product']['id'] ), 'payload' => $payload, 'paths' => $sanitizer->paths( $payload ) );
					}
				}
			}
		}
		include PERSI_CATALOG_ENGINE_PATH . 'templates/admin/olist-diagnostic.php';
	}
}
