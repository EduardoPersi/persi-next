<?php
defined( 'ABSPATH' ) || exit;

$connected = ! empty( $tokens['refresh_token'] );
$counters  = $run ? json_decode( (string) $run->counters, true ) : array();
$counters  = is_array( $counters ) ? $counters : array();
$notice    = isset( $_GET['persi_notice'] ) ? sanitize_key( wp_unslash( $_GET['persi_notice'] ) ) : '';
$notice_labels = array( 'scheduled' => 'Processamento agendado.', 'connected' => 'Conta Olist conectada.', 'disconnected' => 'Conta Olist desconectada.', 'confirmation_required' => 'Confirme a sincronização real antes de iniciar.', 'module_required' => 'Selecione pelo menos um módulo.', 'selection_required' => 'Selecione pelo menos um produto.', 'sync_locked' => 'Já existe um processamento em andamento.', 'attributes_dry_run_only' => 'O módulo Atributos está disponível somente em Simulação. Nenhum atributo será gravado no WooCommerce.' );
?>
<div class="wrap">
	<h1><?php esc_html_e( 'Persi Catalog Engine', 'persi-catalog-engine' ); ?></h1>
	<?php if ( $notice ) : ?>
		<div class="notice notice-info"><p><?php echo esc_html( $notice_labels[ $notice ] ?? str_replace( '_', ' ', $notice ) ); ?></p></div>
	<?php endif; ?>

	<h2><?php esc_html_e( 'Conexão Olist ERP', 'persi-catalog-engine' ); ?></h2>
	<table class="widefat striped" style="max-width:800px"><tbody>
		<tr><th><?php esc_html_e( 'Credenciais do aplicativo', 'persi-catalog-engine' ); ?></th><td><?php echo esc_html( $this->configuration->configured() ? 'Configuradas no servidor' : 'Não configuradas' ); ?></td></tr>
		<tr><th><?php esc_html_e( 'Autorização da conta', 'persi-catalog-engine' ); ?></th><td><?php echo esc_html( $connected ? 'Conectada' : 'Não conectada' ); ?></td></tr>
	</tbody></table>
	<p>
	<?php if ( $connected ) : ?>
		<a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=persi_catalog_olist_disconnect' ), 'persi_catalog_olist_disconnect' ) ); ?>"><?php esc_html_e( 'Desconectar Olist', 'persi-catalog-engine' ); ?></a>
	<?php else : ?>
		<a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=persi_catalog_olist_connect' ), 'persi_catalog_olist_connect' ) ); ?>"><?php esc_html_e( 'Conectar Olist', 'persi-catalog-engine' ); ?></a>
	<?php endif; ?>
	</p>

	<h2><?php esc_html_e( 'Sincronização Olist', 'persi-catalog-engine' ); ?></h2>
	<?php if ( $active_run ) : ?><div class="notice notice-warning inline"><p><strong>Existe um processamento em andamento.</strong> <?php echo esc_html( (string) $active_run->processed ); ?> de <?php echo esc_html( (string) $active_run->total_items ); ?> itens. <button type="button" class="button persi-open-progress" data-run-id="<?php echo esc_attr( (string) $active_run->id ); ?>">Ver processamento</button></p></div><?php endif; ?>
	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<input type="hidden" name="action" value="persi_catalog_start">
		<?php wp_nonce_field( 'persi_catalog_start' ); ?>
		<table class="form-table"><tbody>
			<tr><th><label for="persi-mode"><?php esc_html_e( 'Modo', 'persi-catalog-engine' ); ?></label></th><td><select id="persi-mode" name="mode"><option value="dry-run">Simulação — nenhuma alteração</option><option value="sync">Sincronização real</option></select></td></tr>
			<tr><th><?php esc_html_e( 'O que deseja processar?', 'persi-catalog-engine' ); ?></th><td><label><input type="checkbox" name="modules[]" value="gtin" checked> GTIN / EAN</label><br><label><input type="checkbox" disabled> Marca — em desenvolvimento</label><br><label><input type="checkbox" name="modules[]" value="attributes"> Atributos — diagnóstico em modo de simulação</label></td></tr>
			<tr><th><?php esc_html_e( 'Produtos a processar', 'persi-catalog-engine' ); ?></th><td><fieldset id="persi-selection-mode"><label><input type="radio" name="selection_mode" value="automatic" checked> Seleção automática</label>&nbsp;&nbsp;<label><input type="radio" name="selection_mode" value="manual"> Selecionar produtos manualmente</label></fieldset></td></tr>
			<tr class="persi-automatic-field"><th><label for="persi-scope"><?php esc_html_e( 'Critério', 'persi-catalog-engine' ); ?></label></th><td><select id="persi-scope" name="scope"><option value="missing-unchecked">Novos produtos sem GTIN — não repetir vazios do Olist</option><option value="missing-gtin">Todos sem GTIN — incluir produtos já consultados</option><option value="failures">Reprocessar falhas</option><option value="all">Todos os produtos — auditoria completa</option></select><p class="description">O primeiro critério pode encontrar menos itens que o máximo solicitado quando os demais já foram consultados ou preenchidos.</p></td></tr>
			<tr class="persi-automatic-field"><th><label for="persi-limit"><?php esc_html_e( 'Máximo de itens', 'persi-catalog-engine' ); ?></label></th><td><input id="persi-limit" type="number" name="limit" min="1" max="3100" value="10"><p class="description">O plugin processará até este total, conforme a quantidade disponível no critério escolhido.</p></td></tr>
			<tr id="persi-manual-field" hidden><th><label for="persi-product-query">Selecionar produtos</label></th><td><div class="persi-search-controls"><input id="persi-product-query" type="search" class="regular-text" placeholder="Pesquisar por nome ou SKU..." autocomplete="off"><select id="persi-product-category"><option value="">Todas as categorias</option><?php foreach ( $product_categories as $term ) : ?><option value="<?php echo esc_attr( (string) $term->term_id ); ?>"><?php echo esc_html( $term->name ); ?></option><?php endforeach; ?></select><?php if ( $product_brands ) : ?><select id="persi-product-brand"><option value="">Todas as marcas</option><?php foreach ( $product_brands as $term ) : ?><option value="<?php echo esc_attr( (string) $term->term_id ); ?>"><?php echo esc_html( $term->name ); ?></option><?php endforeach; ?></select><?php endif; ?></div><p class="description">Digite ao menos 2 caracteres. A pesquisa usa somente dados locais e retorna até 20 itens.</p><div id="persi-search-status" aria-live="polite"></div><div id="persi-search-results" class="persi-product-list"></div><p><button type="button" class="button" id="persi-select-results" hidden>Selecionar resultados</button></p><div class="persi-selection-summary"><strong id="persi-selected-count">0 produtos selecionados</strong> <button type="button" class="button-link-delete" id="persi-clear-selection">Limpar seleção</button></div><div id="persi-selected-inputs"></div><div id="persi-selected-products" class="persi-product-list"></div><p><button type="button" class="button" id="persi-review-selection" disabled>Revisar produtos</button></p><div id="persi-target-preview" class="notice notice-info inline" hidden><p></p></div></td></tr>
			<tr id="persi-sync-confirmation" hidden><th><?php esc_html_e( 'Confirmação de escrita', 'persi-catalog-engine' ); ?></th><td><label><input id="persi-confirm-sync" type="checkbox" name="confirm_sync" value="1"> Confirmo que desejo executar a sincronização real</label><p class="description">Produtos aprovados poderão ser alterados. O modo de simulação não exige confirmação.</p></td></tr>
		</tbody></table>
		<?php submit_button( __( 'Iniciar processamento', 'persi-catalog-engine' ), 'primary', 'submit', true, $active_run ? array( 'disabled' => 'disabled' ) : array() ); ?>
	</form>

	<h2><?php esc_html_e( 'Última execução', 'persi-catalog-engine' ); ?></h2>
	<?php if ( ! $run ) : ?><p><?php esc_html_e( 'Nenhuma execução registrada.', 'persi-catalog-engine' ); ?></p><?php else : ?>
		<?php $scope_labels = array( 'missing-unchecked' => 'Novos produtos sem GTIN', 'missing-gtin' => 'Todos os produtos sem GTIN', 'failures' => 'Reprocessar falhas', 'all' => 'Todos os produtos', 'selected' => 'Seleção manual' ); ?>
		<?php $mode_labels = array( 'sync' => 'Sincronização real', 'dry-run' => 'Simulação' ); $module_labels = array( 'gtin' => 'GTIN / EAN', 'attributes' => 'Atributos' ); $status_labels = array( 'pending' => 'Aguardando', 'running' => 'Em processamento', 'completed' => 'Concluído', 'failed' => 'Falhou', 'cancelled' => 'Cancelado', 'SKIPPED' => 'Ignorado', 'AMBIGUOUS_MATCH' => 'Correspondência ambígua', 'OLIST_NO_GTIN' => 'Sem GTIN no Olist', 'UPDATED' => 'Atualizado', 'WOULD_UPDATE' => 'Seria atualizado', 'ALREADY_SYNCED' => 'Já sincronizado', 'OLIST_NOT_FOUND' => 'Não encontrado no Olist', 'API_ERROR' => 'Erro na API', 'INVALID_GTIN' => 'GTIN inválido', 'GTIN_CONFLICT' => 'Conflito de GTIN', 'NO_SKU' => 'Sem SKU', 'ATTRIBUTE_SKIPPED' => 'Atributo ignorado', 'ATTRIBUTE_DISCOVERED' => 'Atributo descoberto', 'ATTRIBUTE_WOULD_UPDATE' => 'Atributo seria atualizado', 'ATTRIBUTE_ALREADY_SYNCED' => 'Atributo já existente', 'ATTRIBUTE_CONFLICT' => 'Conflito de atributo', 'ATTRIBUTE_MAPPING_REQUIRED' => 'Mapeamento necessário', 'ATTRIBUTE_REVIEW_REQUIRED' => 'Revisão necessária' ); $run_modules = array_map( static fn( string $module ): string => $module_labels[ $module ] ?? $module, array_filter( explode( ',', (string) $run->modules ) ) ); ?>
		<p><strong>Modo:</strong> <?php echo esc_html( $mode_labels[ $run->mode ] ?? $run->mode ); ?> · <strong>Módulos:</strong> <?php echo esc_html( implode( ' + ', $run_modules ) ); ?> · <strong>Seleção:</strong> <?php echo esc_html( $scope_labels[ $run->scope ] ?? $run->scope ); ?> · <strong>Status:</strong> <?php echo esc_html( $status_labels[ $run->status ] ?? $run->status ); ?> · <strong>Analisados:</strong> <?php echo esc_html( (string) $run->processed ); ?> de <?php echo esc_html( (string) $run->total_items ); ?> disponíveis<?php if ( (int) $run->requested_limit > (int) $run->total_items ) : ?> (<?php echo esc_html( (string) $run->requested_limit ); ?> solicitados)<?php endif; ?></p>
		<?php if ( 'failed' === $run->status ) : ?><div class="notice notice-error inline"><p><strong>Falha em <?php echo esc_html( ( $run->failure_stage ?? '' ) ?: 'etapa desconhecida' ); ?>:</strong> <?php echo esc_html( ( $run->failure_message ?? '' ) ?: 'Consulte o Action Scheduler e os logs do servidor.' ); ?> <code><?php echo esc_html( (string) ( $run->failure_code ?? '' ) ); ?></code></p></div><?php endif; ?>
		<?php if ( false !== strpos( (string) $run->modules, 'attributes' ) ) : ?><p><a class="button" href="<?php echo esc_url( admin_url( 'admin.php?page=persi-catalog-attributes&run_id=' . absint( $run->id ) ) ); ?>">Ver candidatos de atributos</a></p><?php endif; ?>
		<table class="widefat striped" style="max-width:800px"><thead><tr><th>Situação</th><th>Total</th></tr></thead><tbody>
		<?php $attribute_status_labels = array( 'ATTRIBUTE_CANDIDATE' => 'Novo candidato', 'ATTRIBUTE_NO_VALUE' => 'Sem valor encontrado', 'ATTRIBUTE_UNSUPPORTED_CONTEXT' => 'Contexto não suportado' ); foreach ( $counters as $status => $total ) : ?><tr><td><?php echo esc_html( $status_labels[ $status ] ?? $attribute_status_labels[ $status ] ?? $status ); ?></td><td><?php echo esc_html( (string) absint( $total ) ); ?></td></tr><?php endforeach; ?>
		</tbody></table>
		<?php if ( \Persi\CatalogEngine\Support\Performance::enabled() ) : $performance_metrics = json_decode( (string) ( $run->performance_metrics ?? '' ), true ); $performance_metrics = is_array( $performance_metrics ) ? $performance_metrics : array(); ?>
			<h3>Diagnóstico de performance</h3><table class="widefat striped" style="max-width:800px"><thead><tr><th>Etapa</th><th>Total</th><th>Amostras</th><th>Média</th></tr></thead><tbody><?php foreach ( $performance_metrics as $metric_name => $metric ) : $metric_count = max( 1, absint( $metric['count'] ?? 0 ) ); ?><tr><td><code><?php echo esc_html( $metric_name ); ?></code></td><td><?php echo esc_html( number_format_i18n( (float) ( $metric['total_ms'] ?? 0 ), 2 ) ); ?> ms</td><td><?php echo esc_html( (string) absint( $metric['count'] ?? 0 ) ); ?></td><td><?php echo esc_html( number_format_i18n( (float) ( $metric['total_ms'] ?? 0 ) / $metric_count, 2 ) ); ?> ms</td></tr><?php endforeach; ?></tbody></table>
		<?php endif; ?>
		<h3 id="persi-audit"><?php esc_html_e( 'Auditoria', 'persi-catalog-engine' ); ?></h3>
		<table class="widefat striped"><thead><tr><th>Produto</th><th>SKU</th><th>Situação</th><th>Campo / fonte</th><th>Valor anterior no WooCommerce</th><th>Olist</th><th>Data UTC</th></tr></thead><tbody>
		<?php foreach ( $logs as $log ) : ?><tr><td><?php echo esc_html( $log->product_name ); ?> (#<?php echo esc_html( (string) $log->product_id ); ?>)</td><td><?php echo esc_html( $log->sku ); ?></td><td><?php echo esc_html( $status_labels[ $log->status ] ?? $log->status ); ?><?php if ( $log->details ) : ?><br><small><code><?php echo esc_html( $log->details ); ?></code></small><?php endif; ?></td><td><?php echo esc_html( ( 'global_unique_id' === $log->field_name ? 'GTIN oficial' : $log->field_name ) . ' / ' . ( 'Olist ERP' === $log->source ? 'Olist ERP' : $log->source ) ); ?></td><td><?php echo esc_html( $log->old_value ?: '[vazio]' ); ?></td><td><?php echo esc_html( $log->new_value ?: '[vazio]' ); ?></td><td><?php echo esc_html( $log->created_at ); ?></td></tr><?php endforeach; ?>
		</tbody></table>
	<?php endif; ?>

	<div id="persi-progress-modal" class="persi-modal" hidden aria-hidden="true">
		<div class="persi-modal__backdrop"></div><div class="persi-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="persi-progress-title">
			<h2 id="persi-progress-title">Persi Catalog Engine</h2><p id="persi-progress-mode" class="persi-mode-banner"></p>
			<h3 id="persi-progress-heading">Preparando produtos...</h3>
			<div class="persi-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span id="persi-progress-bar"></span></div>
			<p><strong id="persi-progress-percent">Preparando fila...</strong> <span id="persi-progress-count"></span></p>
			<dl class="persi-current"><dt>Produto atual</dt><dd id="persi-current-product">—</dd><dt>SKU</dt><dd id="persi-current-sku">—</dd><dt>Etapa</dt><dd><span id="persi-current-message">Preparando produtos...</span><br><small>Situação: <code id="persi-current-stage">Preparando fila</code></small></dd></dl>
			<div id="persi-progress-counters" class="persi-counters"></div>
			<p id="persi-progress-time"></p>
			<p id="persi-progress-rate"></p>
			<p class="description">Você pode sair desta página. O processamento continuará em segundo plano.</p>
			<p class="persi-modal__actions"><button type="button" class="button button-link-delete" id="persi-cancel-progress">Cancelar sincronização</button> <a class="button" href="#persi-audit">Ver auditoria</a> <button type="button" class="button button-primary" id="persi-close-progress">Fechar</button></p>
		</div>
	</div>
</div>
