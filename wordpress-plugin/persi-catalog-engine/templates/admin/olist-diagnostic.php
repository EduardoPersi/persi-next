<?php defined( 'ABSPATH' ) || exit; ?>
<div class="wrap">
	<h1>Diagnóstico Olist</h1>
	<p>Consulta somente leitura. A resposta não é salva e campos sensíveis conhecidos são removidos.</p>
	<form method="post">
		<?php wp_nonce_field( 'persi_olist_diagnostic' ); ?>
		<table class="form-table"><tbody>
			<tr><th><label for="product_id">ID WooCommerce</label></th><td><input id="product_id" name="product_id" type="number" min="1"></td></tr>
			<tr><th><label for="sku">ou SKU</label></th><td><input id="sku" name="sku" type="text" maxlength="191"></td></tr>
		</tbody></table>
		<?php submit_button( 'Consultar detalhe completo' ); ?>
	</form>
	<?php if ( $error ) : ?><div class="notice notice-error inline"><p><?php echo esc_html( $error ); ?></p></div><?php endif; ?>
	<?php if ( $result ) : ?>
		<h2>Correspondência</h2>
		<table class="widefat striped" style="max-width:900px"><tbody>
			<tr><th>Produto Woo</th><td><?php echo esc_html( $result['product'] ? $result['product']->get_name() : 'Localizado diretamente pelo SKU' ); ?></td></tr>
			<tr><th>SKU</th><td><?php echo esc_html( $result['sku'] ); ?></td></tr>
			<tr><th>ID Olist</th><td><?php echo esc_html( (string) $result['olist_id'] ); ?></td></tr>
		</tbody></table>
		<h2>Caminhos disponíveis na resposta real</h2>
		<textarea readonly rows="18" class="large-text code"><?php echo esc_textarea( implode( "\n", $result['paths'] ) ); ?></textarea>
		<details><summary><strong>Resposta sanitizada</strong></summary><pre style="white-space:pre-wrap;max-height:600px;overflow:auto;background:#fff;padding:16px;border:1px solid #ccd0d4"><?php echo esc_html( wp_json_encode( $result['payload'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) ); ?></pre></details>
	<?php endif; ?>
</div>
