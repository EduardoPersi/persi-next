# Persi Catalog Engine — Fase 1

## Responsabilidade

O plugin consulta exclusivamente produtos na Olist ERP API v3 por código/SKU e pode escrever exclusivamente `global_unique_id` pelo CRUD oficial do WooCommerce. Não registra hooks de salvamento de produto e não executa sincronização contínua.

## Contrato Olist confirmado

- OAuth 2 Authorization Code;
- autorização: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth`;
- token/refresh: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token`;
- access token: 4 horas;
- refresh token: 1 dia;
- API: `GET https://api.tiny.com.br/public-api/v3/produtos`;
- filtro: `codigo={SKU}`;
- retorno da listagem: `id`, `sku` e `gtin`;
- paginação: `limit` (100 por padrão) e `offset`;
- rate limit: `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset`.

O filtro da API não é tratado como prova de igualdade. O matcher conserva somente itens cujo `sku` seja exatamente igual à string do SKU WooCommerce. Zero resultados produzem `OLIST_NOT_FOUND`; mais de um produz `AMBIGUOUS_MATCH`.

## Processamento

Cada execução possui um registro em `wp_persi_catalog_runs`. Cada resultado de produto ou variação é gravado em `wp_persi_catalog_logs`. O prefixo real acompanha `$wpdb->prefix`.

Seleções preparadas pela lista de produtos são persistidas por execução em `wp_persi_catalog_run_items`. A fila registra produto, pai, tipo do alvo e módulos. Na versão 0.4.0 somente o módulo `gtin` é executável. A coluna de módulos existe para permitir a evolução controlada para marca e atributos sem misturar regras de escrita.

O Action Scheduler processa até 20 itens por ação por padrão, respeitando também um orçamento de 25 segundos. O lote pode ser ajustado com `PERSI_CATALOG_BATCH_SIZE`. Um lock global em option, com expiração de 30 minutos e renovação por lote, impede runs simultâneos. Um segundo lock exclusivo e curto protege cada worker contra concorrência entre o Action Scheduler e o watchdog autenticado do painel.

Produtos e `product_variation` são enumerados separadamente. Cada objeto fornece seu próprio SKU e seu próprio `global_unique_id`.

O escopo padrão consulta a tabela oficial `wc_product_meta_lookup` e seleciona somente linhas cujo `global_unique_id` esteja vazio ou ausente. Também usa a auditoria para excluir itens que já terminaram como `OLIST_NO_GTIN`. A paginação usa `ID > cursor`, e não offset, para não pular itens quando uma sincronização real remove produtos do conjunto de pendências.

O operador pode escolher "Sem GTIN — incluir novamente os vazios já analisados" depois de cadastrar novos códigos no Olist. Isso evita uma exclusão permanente e mantém o ERP como fonte de verdade. O modo "Todos" permanece disponível para auditoria completa e conflitos.

## Fila e seleção automática

O plugin não adiciona colunas próprias em **Produtos → Todos os produtos**. GTIN e marca permanecem visíveis pelas colunas nativas ou por outras extensões já instaladas, evitando informação duplicada e mantendo a listagem mais compacta. O Persi Catalog Engine não consulta o Olist durante a renderização dessa tela.

A versão 0.6.0 removeu a ação em massa; a versão 0.7.0 otimizou a preparação. Na versão 0.8.0, o painel aceita seleção automática ou manual. A manual pesquisa somente o catálogo local e persiste os alvos validados na mesma `persi_catalog_run_items`. `missing-unchecked` exige `global_unique_id` vazio e exclui resultados anteriores `OLIST_NO_GTIN`; `missing-gtin` inclui esses vazios anteriores; `failures` recupera falhas auditadas; `all` faz auditoria completa; `selected` usa somente os produtos escolhidos.

Cada item pode possuir seus próprios módulos. Para um produto variável, Atributos aponta uma vez para o pai e GTIN aponta somente para variações com SKU próprio. Atributos permanece exclusivamente em descoberta/Dry Run, sem qualquer rotina de escrita.

O total persistido é o número real de linhas em `persi_catalog_run_items`, limitado pelo operador. O processamento sempre lê essa fila imutável, evitando que uma escrita de GTIN altere o conjunto durante a paginação.

## Progresso administrativo

O Action Scheduler atualiza no run o produto atual, SKU, estágio, mensagem, contadores e quantidade processada. O endpoint autenticado `wp_ajax_persi_catalog_progress` exige `manage_woocommerce` e nonce e lê somente esse estado local. O modal consulta o endpoint a cada 2 segundos; não chama o Olist e não executa trabalho de catálogo no navegador.

Fechar modal, página ou navegador apenas interrompe o polling. As ações agendadas continuam no servidor. O lock persiste o ID do run ativo e permite reabrir seu progresso, impedindo uma segunda execução enquanto estiver válido.

Detalhes de instrumentação, fila em bulk, cache e orçamento do worker estão em `docs/performance.md`.

## Preparação para marca e atributos

- Fonte autoritativa futura de marca: objeto `marca` do detalhe do produto no Olist, confirmado por ID/SKU exato.
- Destino principal: taxonomia oficial do WooCommerce `product_brand` no produto pai.
- Compatibilidade opcional: espelhar em `pa_marca` apenas após validação da configuração da loja.
- Atributos e marca nunca devem ser inferidos automaticamente de texto livre para escrita. A descrição pode gerar sugestões revisáveis, com confiança e origem registradas.
- Variações recebem GTIN próprio; marca e atributos compartilhados pertencem ao pai, salvo atributo realmente específico da variação.
- Cada módulo futuro precisa de Dry Run, estados de conflito, confirmação explícita e auditoria separada por campo e fonte.
- Reprocessar `OLIST_NO_GTIN` será uma decisão independente de reprocessar marca/atributos ausentes.

## Fase 2 — descoberta de atributos

Na versão 0.5.0, `attributes` é um módulo exclusivamente analítico. A execução lê Olist, WooCommerce, título e descrição, grava propostas em `{prefix}persi_catalog_attribute_candidates` e nunca chama APIs de escrita de atributos ou termos.

O diagnóstico consulta `GET /produtos/{id}` depois da correspondência exata por SKU. Como a documentação pública não descreve de forma suficiente o JSON completo da API v3, o painel exibe os caminhos da resposta real e uma cópia sanitizada em memória. Tokens, secrets, autorização e cookies são removidos; a resposta não é persistida.

O dicionário canônico separa conceito de taxonomia. `CategorySchemas` permite regras somente quando uma família é reconhecida. Um valor em milímetros não implica bitola globalmente. Medidas compostas permanecem `ATTRIBUTE_REVIEW_REQUIRED`.

Fontes registradas: `OLIST_STRUCTURED`, `WOO_EXISTING`, `TITLE_RULE` e `DESCRIPTION_RULE`. A descrição nunca resulta em proposta automática de escrita. Confianças iniciais: `EXACT_STRUCTURED`, `HIGH` e `LOW`.

A tabela `{prefix}persi_catalog_attribute_mappings` prepara aliases globais ou específicos por categoria, normalizador, aprovação e `auto_write`. Nesta versão não há interface de aprovação e `auto_write` permanece sem consumidor, garantindo que um mapeamento armazenado não possa escrever produtos.

## Decisão de escrita

1. SKU vazio: `NO_SKU`.
2. Correspondência ausente/ambígua: nenhuma escrita.
3. GTIN Olist vazio/inválido: nenhuma escrita.
4. Woo e Olist iguais: `ALREADY_SYNCED`.
5. Woo preenchido e diferente: `GTIN_CONFLICT`.
6. Woo vazio e Dry Run: `WOULD_UPDATE`.
7. Woo vazio e execução real: `set_global_unique_id()` e `save()`, resultando em `UPDATED` somente após sucesso.

## Segredos

Client ID e client secret são lidos de constantes de servidor. Access e refresh tokens são cifrados com AES-256-GCM usando chave derivada dos salts do WordPress. Tokens nunca são exibidos nem gravados nos logs. A desinstalação apaga tokens, mas preserva tabelas de auditoria.

## Primeiro Dry Run

1. Instalar e ativar em staging ou produção sem iniciar execução.
2. Definir `PERSI_CATALOG_OLIST_CLIENT_ID` e `PERSI_CATALOG_OLIST_CLIENT_SECRET` fora do Git.
3. Cadastrar no aplicativo Olist o callback exibido no `readme.txt`.
4. Abrir **WooCommerce → Persi Catálogo** e selecionar **Conectar Olist**.
5. Selecionar **Dry Run — nenhuma escrita**, **Sem GTIN — ignorar os já encontrados vazios no Olist** e manter o máximo em `10`.
6. Iniciar e acompanhar o Action Scheduler até a execução aparecer como `completed`.
7. Conferir os 10 registros: produto, SKU, valor Woo anterior, GTIN Olist e status.
8. Comparar manualmente os SKUs e GTINs no Olist ERP.
9. Não selecionar sincronização real até aprovação explícita dos resultados.
