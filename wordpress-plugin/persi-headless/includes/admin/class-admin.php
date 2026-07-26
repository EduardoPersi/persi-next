<?php

defined( 'ABSPATH' ) || exit;

class Persi_Headless_Admin {
	public function register() {
		add_action( 'admin_menu', array( $this, 'menu' ), 60 );
		add_action( 'admin_init', array( $this, 'settings' ) );
		add_action( 'admin_post_persi_headless_clear_cache', array( $this, 'clear_cache' ) );
	}

	public function menu() {
		add_submenu_page( 'woocommerce', __( 'Persi Headless', 'persi-headless' ), __( 'Persi Headless', 'persi-headless' ), 'manage_woocommerce', 'persi-headless', array( $this, 'render' ) );
	}

	public function settings() {
		register_setting( 'persi_headless', Persi_Headless_Settings::OPTION, array( 'sanitize_callback' => array( $this, 'sanitize' ), 'default' => array() ) );
	}

	public function sanitize( $input ) {
		$current = Persi_Headless_Settings::all();
		$urls = preg_split( '/\r\n|\r|\n/', (string) ( $input['frontend_urls_text'] ?? '' ) );
		$urls = array_values( array_filter( array_map( 'esc_url_raw', array_map( 'trim', $urls ) ) ) );
		return array(
			'frontend_urls' => $urls ?: array( 'https://persimateriais.com.br' ),
			'modules' => array(
				'product_families' => ! empty( $input['modules']['product_families'] ),
				'bought_together' => ! empty( $input['modules']['bought_together'] ),
				'stock_notifications' => ! empty( $input['modules']['stock_notifications'] ),
				'order_bump' => false,
			),
			'double_opt_in' => ! empty( $input['double_opt_in'] ),
			'batch_size' => min( 100, max( 1, absint( $input['batch_size'] ?? 25 ) ) ),
			'logging' => ! empty( $input['logging'] ),
		);
	}

	public function clear_cache() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_die( esc_html__( 'Sem permissão.', 'persi-headless' ) ); }
		check_admin_referer( 'persi_headless_clear_cache' );
		Persi_Headless_Cache::invalidate();
		wp_safe_redirect( add_query_arg( 'cache-cleared', '1', admin_url( 'admin.php?page=persi-headless' ) ) );
		exit;
	}

	public function render() {
		$settings = Persi_Headless_Settings::all();
		$modules = $settings['modules'] ?? array();
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Persi Headless', 'persi-headless' ); ?></h1>
			<table class="widefat striped" style="max-width:900px">
				<tbody>
					<tr><th><?php esc_html_e( 'Versão', 'persi-headless' ); ?></th><td><?php echo esc_html( PERSI_HEADLESS_VERSION ); ?></td></tr>
					<tr><th><?php esc_html_e( 'API base', 'persi-headless' ); ?></th><td><code><?php echo esc_html( rest_url( 'persi/v1' ) ); ?></code></td></tr>
					<tr><th>WooCommerce</th><td><?php echo class_exists( 'WooCommerce' ) ? esc_html__( 'Disponível', 'persi-headless' ) : esc_html__( 'Indisponível', 'persi-headless' ); ?></td></tr>
					<tr><th>Action Scheduler</th><td><?php echo function_exists( 'as_schedule_single_action' ) ? esc_html__( 'Disponível', 'persi-headless' ) : esc_html__( 'Indisponível', 'persi-headless' ); ?></td></tr>
					<tr><th><?php esc_html_e( 'Grupo da fila', 'persi-headless' ); ?></th><td><code>persi-headless-stock-notifications</code> — <a href="<?php echo esc_url( admin_url( 'admin.php?page=wc-status&tab=action-scheduler' ) ); ?>"><?php esc_html_e( 'Ações agendadas', 'persi-headless' ); ?></a></td></tr>
				</tbody>
			</table>
			<form method="post" action="options.php">
				<?php settings_fields( 'persi_headless' ); ?>
				<h2><?php esc_html_e( 'Módulos', 'persi-headless' ); ?></h2>
				<?php foreach ( array( 'product_families' => 'Famílias de produtos', 'bought_together' => 'Compre junto', 'stock_notifications' => 'Retorno ao estoque' ) as $key => $label ) : ?>
					<p><label><input type="checkbox" name="<?php echo esc_attr( Persi_Headless_Settings::OPTION ); ?>[modules][<?php echo esc_attr( $key ); ?>]" value="1" <?php checked( ! empty( $modules[ $key ] ) ); ?>> <?php echo esc_html( $label ); ?></label></p>
				<?php endforeach; ?>
				<p><label><input type="checkbox" disabled> <?php esc_html_e( 'Order bump (reservado, desabilitado)', 'persi-headless' ); ?></label></p>
				<h2><?php esc_html_e( 'Frontend e envio', 'persi-headless' ); ?></h2>
				<p><label><?php esc_html_e( 'Origens do frontend (uma por linha)', 'persi-headless' ); ?><br><textarea class="large-text" rows="4" name="<?php echo esc_attr( Persi_Headless_Settings::OPTION ); ?>[frontend_urls_text]"><?php echo esc_textarea( implode( "\n", $settings['frontend_urls'] ?? array() ) ); ?></textarea></label></p>
				<p><label><input type="checkbox" name="<?php echo esc_attr( Persi_Headless_Settings::OPTION ); ?>[double_opt_in]" value="1" <?php checked( ! empty( $settings['double_opt_in'] ) ); ?>> <?php esc_html_e( 'Exigir confirmação por e-mail', 'persi-headless' ); ?></label></p>
				<p><label><?php esc_html_e( 'Tamanho do lote', 'persi-headless' ); ?> <input type="number" min="1" max="100" name="<?php echo esc_attr( Persi_Headless_Settings::OPTION ); ?>[batch_size]" value="<?php echo esc_attr( $settings['batch_size'] ?? 25 ); ?>"></label></p>
				<?php submit_button(); ?>
			</form>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="persi_headless_clear_cache"><?php wp_nonce_field( 'persi_headless_clear_cache' ); ?>
				<?php submit_button( __( 'Limpar cache público', 'persi-headless' ), 'secondary' ); ?>
			</form>
		</div>
		<?php
	}
}
