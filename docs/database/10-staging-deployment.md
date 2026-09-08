# Deploy controlado — persi-staging

## Escopo e identificação

- Ambiente: Supabase `persi-staging` (`vtrujmhhkmvjzfklzxip`), organização Persi.
- Região: São Paulo.
- Data da execução: 2026-08-23.
- O ambiente estava vazio antes do deploy: nenhuma tabela de domínio, migration ou dado real.
- Produção, WooCommerce, Olist, checkout, pagamentos, DNS e Hostinger não foram acessados nem alterados.

## Backup e recuperação

Antes do deploy, a inspeção da CLI confirmou backups gerenciados por WALG, PITR
desabilitado e nenhum ponto anterior disponível, coerente com o projeto recém-criado.
O staging vazio foi registrado antes da primeira migration. Restore/PITR não foi presumido.

## PostgreSQL e extensões

- PostgreSQL remoto: 17.6; PostgreSQL local validado: 17.6.
- Extensões confirmadas: `pgcrypto`, `pg_trgm` e `unaccent` no schema `extensions`.
  A plataforma também mantém `pg_stat_statements`, `uuid-ossp` e `supabase_vault`.
- Generated columns, triggers diferidos, índices parciais, enums, PL/pgSQL e RLS
  foram aceitos pelo PostgreSQL remoto.

## Deploy e histórico

O dry-run apresentou somente as seis migrations esperadas. O deploy foi feito pelo
Supabase CLI, sem SQL manual no dashboard:

```text
20260823110000_core.sql
20260823110100_catalog.sql
20260823110200_pim.sql
20260823110300_pricing.sql
20260823110400_inventory.sql
20260823110500_external_mappings.sql
```

O histórico remoto reconhece exatamente as seis versões locais.

## Validação estrutural e segurança

- 21 tabelas de domínio, todas vazias após o deploy;
- 64 constraints, 28 índices, 12 funções de domínio e 23 triggers;
- duas generated columns (`sku_normalized` e `quantity_available`);
- RLS habilitada em 21/21 tabelas;
- policies públicas: 0;
- schema estrutural local e staging equivalente para todos os objetos de domínio.

O staging adiciona apenas a função gerenciada `public.rls_auto_enable()`. O dump local
contém grants default de sequence que não existem no remoto. Essas diferenças de plataforma
e permissão não alteram o schema de domínio. A Data API inclui `public` na configuração
padrão, mas RLS sem policies impede acesso por `anon`/`authenticated`; nenhuma policy
permissiva foi criada. A arquitetura continua browser → Next.js → DAL server-side → PostgreSQL.

## Conexão e pooler

Estratégia mantida: conexão direta para migrations e Supavisor transaction pooler para o
runtime, com Postgres.js usando `prepare: false`. A autenticação foi validada em ambos:

- direct connection: PostgreSQL 17.6, conexão inicial aproximada de 310 ms;
- transaction pooler: PostgreSQL 17.6, conexão inicial aproximada de 373 ms;
- dez SELECTs iniciais: direct p50 10 ms/p95 12 ms; pooler p50 12 ms/p95 24 ms.

Drizzle conectou ao PostgreSQL real e validou SELECT, transação, UUID, timestamptz e
`BIGINT → TypeScript bigint`. O pooler aceitou múltiplas requisições e os testes concorrentes
com `prepare: false`, sem timeout ou erro de conexão.

## Testes remotos

- pgTAP: 29/29, 0 falhas, executado em transação com rollback;
- PIM: medida composta e fração imperial exata aprovadas;
- pricing: minor units em bigint e rejeição de períodos sobrepostos aprovadas;
- inventory: reserva, liberação, saldo gerado e ledger aprovados;
- external mappings: identidades entre sistemas e rejeição de duplicidade aprovadas;
- concorrência 2 requisições/1 unidade: 1 sucesso, 1 rejeição, zero overselling;
- concorrência 10 requisições/5 unidades: 5 sucessos, 5 rejeições, zero overselling.

O `db push` não executa `seed.sql`. Para manter o pgTAP remoto autocontido, as unidades
`mm` e `in` são inseridas dentro da transação do teste e removidas pelo rollback. As demais
fixtures usam UUID/tag exclusivos e são apagadas em ordem compatível com as FKs `RESTRICT`.
A auditoria final encontrou zero linhas nas 21 tabelas e zero fixtures marcadas.

## Latência baseline

Vinte amostras por operação, via transaction pooler, sem finalidade de stress:

| Operação | p50 | p95 |
| --- | ---: | ---: |
| SELECT simples | 9,6 ms | 16,9 ms |
| lookup de SKU | 19,2 ms | 43,3 ms |
| product + variant | 19,4 ms | 31,1 ms |
| inventory lookup | 18,9 ms | 32,4 ms |
| transação de reserva | 20,8 ms | 260,8 ms |

O p95 de reserva é apenas baseline de uma amostra pequena e inclui variação de rede/pooler;
não indica overselling ou falha transacional.

## Comandos reproduzíveis

Executar somente depois de confirmar inequivocamente o ref de staging:

```text
npx supabase projects list
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked --yes
npx supabase inspect db table-stats --linked
```

URLs e senhas devem permanecer em variáveis privadas ou arquivos `.env*` ignorados. Nunca
usar prefixo `NEXT_PUBLIC_`. Não configurar a aplicação pública nesta fase.

## PIM P.6-D — persistência operacional de conflitos

Em 2026-09-01, a migration `20260901233000_pim_conflicts.sql` foi aplicada somente no
`persi-staging` (`vtrujmhhkmvjzfklzxip`), após backup lógico oficial e validação local completa.
A tabela `pim_conflicts` mantém RLS habilitada, zero policies públicas e identidade lógica
idempotente por produto, atributo, classificação, fingerprints e versão do detector.

O manifest imutável de hash
`34d9d5cd00d01ab595576622aaebd009b4b9179db58a837cdc9a180d8ba12bd2` persistiu exatamente
115 conflitos ativos, com status `open`, associados a 95 produtos. A verificação posterior
encontrou zero linhas ausentes, inesperadas ou duplicadas; a reaplicação dry-run produziria
zero writes. Evidências estruturadas permanecem disponíveis para revisão humana no painel.

Essa persistência não aprova sugestões, não cria drafts e não publica conteúdo. Produção,
WooCommerce, Olist, preço, estoque, mídia e integrações comerciais não foram alterados.

## Estado atual

Fase D concluída. Deploy, schema, RLS, Drizzle, pooler, testes funcionais, concorrência,
latência e limpeza foram validados no `persi-staging`. Nenhum fixture ou dado real permanece
no remoto. Produção e integrações comerciais não foram alteradas.

## B.1-R1 — reconciliação do gap da migration de shipping

Em 2026-09-02, a migration versionada `20260901120000_shipping_core.sql`, que estava
ausente no histórico remoto apesar de uma migration posterior já estar aplicada, foi
reconciliada exclusivamente no `persi-staging` (`vtrujmhhkmvjzfklzxip`). O procedimento
usou `db push --linked --include-all` depois de precheck sem drift parcial, backup completo
e dry-run que selecionou somente essa migration, sem seeds.

O backup anterior à mudança está em
`D:\persi-backups\staging\20260902-141713-pre-shipping-b1`. Os cinco artefatos totalizam
22.112.386 bytes; o SHA-256 do manifesto `checksums.json` é
`8825d50321d25ea1e0c2b33d92750b7266d45b4f7d33213f4fe4cd61f2100407`. Os avisos de
FK circular em `categories` e `units` no dump data-only foram os mesmos já conhecidos;
schema, dados, roles e checksums foram produzidos e validados.

O staging passou a conter `shipping_methods`, `shipments`, `shipment_events`,
`shipping_provider_credentials` e `shipping_quote_cache`, todas vazias. RLS está ativa
nas cinco tabelas, não há policies para `anon`, `authenticated` ou `public`, escrita
anônima foi rejeitada e as credenciais possuem somente colunas ciphertext. As roles
técnicas `persi_app`, `persi_worker` e `persi_readonly`, o enum `shipment_status` e as
extensões de `external_system`/`external_mappings` foram confirmados.

As 18 migrations locais e remotas ficaram alinhadas, e o dry-run posterior retornou zero
pendências. Contagens e assinaturas dos domínios existentes permaneceram idênticas. O
runtime de shipping continua desabilitado: nenhuma cotação, credencial, remessa, evento,
etiqueta ou chamada ao Melhor Envio foi criada. Produção, WooCommerce, Olist, R2, preço,
estoque, checkout e publicação PIM não foram alterados.

Backlog separado para a fase de design seguinte: revalidar a cotação antes de pedido ou
etiqueta (ou versionar a identidade logística do cache), impedir shipment local duplicado

## B.3-A-R1 — customer/store foundation

Em 2026-09-02, a migration `20260902150000_native_customer_foundation.sql` foi aplicada
exclusivamente ao `persi-staging` (`vtrujmhhkmvjzfklzxip`). O SHA-256 da migration validada
é `4d6fbbfbdb6c6b669cfa0fd5a68f4c4f7f8035a491f023be48ef40f21d3de6fb`.

O backup oficial anterior ao deploy está em
`D:\persi-backups\staging\20260902-204119-pre-native-customer-b3a`. Os dumps de schema,
dados e roles totalizam 23.958.831 bytes; o diretório contém cinco arquivos e o SHA-256 de
`checksums.json` é `59acc9e1bf0a65bd03b7f49df11d1c5c5dc1293dab410778ebfe4fcb63d0b4b7`.
Todos os hashes foram recalculados com sucesso. Os únicos warnings foram as referências
circulares já conhecidas em `categories` e `units` no dump data-only.

O histórico local/remoto ficou reconciliado em 19/19 e o dry-run posterior retornou zero
migrations, seeds ou roles pendentes. Foram criadas somente `stores`, `customers`,
`customer_identities`, `customer_addresses`, `customer_status` e `customer_type`. As quatro
tabelas permanecem vazias, com RLS 4/4, zero policies públicas e sem grants para `anon` ou
`authenticated`. `persi_readonly` enxerga apenas `stores`; nenhuma role operacional recebeu
DELETE.

Não existem colunas CPF/CNPJ plaintext, senha ou token de identidade. Documento somente pode
ser representado pelo bundle type/ciphertext/HMAC; nenhuma chave fica no banco. As contagens
de catálogo, pricing, inventory, PIM, conflitos, mídia, mappings e shipping permaneceram
idênticas ao baseline. Nenhuma store real foi inicializada. Produção, WooCommerce, Olist,
pagamentos, frete e autenticação não foram alterados.
antes da existência do ID externo e definir a futura relação entre orders nativos,
shipments e external mappings.

## B.3-B-R1 — native cart foundation

Em 2026-09-02, a migration `20260902190000_native_cart_foundation.sql` foi aplicada
exclusivamente ao `persi-staging` (`vtrujmhhkmvjzfklzxip`). O SHA-256 conferido antes do
deploy foi `316866fc4a8dfa4df4da7c5aff6dfbb7f590a7719ad942d45d6f31666e188d35`.

O backup oficial válido anterior à mudança está em
`D:\persi-backups\staging\20260902-224500-pre-native-cart-b3b`. Seus cinco arquivos
totalizam 23.973.259 bytes e o SHA-256 do manifesto `checksums.json` é
`3dbc4bc2ac678c533af724ca34f4349c61139ccd719d35108f364a0c30053887`. Schema, dados,
roles e checksums foram produzidos e validados. Os únicos avisos foram as referências
circulares já conhecidas em `categories` e `units`. A tentativa anterior em
`20260902-222310-pre-native-cart-b3b` ficou incompleta, não possui manifesto e não deve ser
usada para restauração.

O dry-run anterior selecionou somente a migration B.3-B, sem seeds ou roles. O histórico
local/remoto ficou reconciliado em 20/20 e o dry-run posterior retornou zero pendências.
Foram criados o enum `cart_status`, as tabelas `carts` e `cart_items` e as funções atômicas
`add_native_cart_item`, `set_native_cart_item_quantity`, `remove_native_cart_item` e
`merge_native_carts`. As funções são `SECURITY INVOKER`; execução pública, anônima e
autenticada está revogada.

As duas tabelas permanecem vazias. RLS está habilitada em 2/2. Existem apenas policies
técnicas para `persi_app` e `persi_worker`; não existem policies nem grants para `anon`,
`authenticated` ou `public`, e `persi_readonly` não possui acesso. O token guest bruto não
é armazenado: somente fingerprint SHA-256, com formato e unicidade protegidos e escopo de
store obrigatório. Linhas de carrinho não armazenam preço, frete, endereço, PII ou reserva
de inventário.

As contagens de catálogo, pricing, inventory, reservas, movimentos, PIM, conflitos, mídia,
mappings, shipping e a fundação B.3-A permaneceram idênticas ao baseline. A regressão local
passou em 237/237 testes pgTAP, 8/8 testes de aplicação do carrinho e 20 ciclos/60 cenários
concorrentes sem falhas. O runtime nativo continua desabilitado; Woo Cart-Token, storefront,
checkout, shipping e reservas de estoque permanecem inalterados. Produção não foi acessada.

## B.3-C1-R1 — native checkout foundation

Em 2026-09-02, a migration `20260902230000_native_checkout_foundation.sql` foi aplicada
exclusivamente ao `persi-staging` (`vtrujmhhkmvjzfklzxip`, PostgreSQL 17.6). O SHA-256
validado antes do deploy foi
`567841438537102d8540595e370048a8dfa3588f0cd784e9d97ddc44f8ddaf6e`.

O backup oficial anterior à mudança está em
`D:\persi-backups\staging\20260902-232626-pre-native-checkout-b3c1`. Os cinco artefatos
de schema, dados, roles e checksums totalizam 22.166.408 bytes. O SHA-256 do manifesto
`checksums.json` é
`7968d1aefb9d4629e4163f783473ee235a39a0449a5805571fe6ec31709472aa`; arquivos,
tamanhos e hashes foram revalidados. O dump de dados repetiu os avisos de FKs circulares
de `categories` e `units` e registrou também a autorreferência esperada de merge em `carts`.

O dry-run anterior selecionou somente a C1, sem seeds ou roles. O histórico ficou 21/21 e
o dry-run posterior retornou banco atualizado, zero migrations, seeds ou roles pendentes.
Foram criados `checkout_sessions`, `checkout_session_items`,
`checkout_shipping_quotes`, o enum `checkout_session_status`, cinco funções de
orquestração/proteção e cinco triggers. `carts` recebeu apenas a unicidade composta
`(id, store_id)` e `inventory_reservations` recebeu o vínculo opcional e restritivo com
`checkout_session_items`, com índices de consulta e unicidade por item/local.

RLS está habilitada em 3/3 tabelas. Existem seis policies `SELECT`, limitadas a
`persi_app` e `persi_worker`; `anon`, `authenticated`, `public` e `persi_readonly` não
possuem acesso. `prepare_native_checkout` e `close_native_checkout` são
`SECURITY DEFINER`, possuem `search_path` vazio e execução pública/browser revogada.
As demais funções C1 são `SECURITY INVOKER`. As funções existentes de reserva,
liberação e confirmação de inventário permanecem presentes e não foram substituídas.

As novas tabelas, `stores`, `customers`, `carts`, `cart_items`, reservas e movimentos
permaneceram vazios. Antes e depois havia 3.080 produtos, variantes, preços e níveis de
inventário; 2.323 suggestions PIM, 1 profile, 3 eventos de auditoria, 115 conflitos,
6.324 mídias e 12.902 mappings. Shipping permaneceu vazio. Nenhum dado operacional foi
alterado. O runtime de carrinho e checkout nativos continua desabilitado; Woo cart,
Cart-Token, checkout e criação de pedidos permanecem inalterados. Produção não foi
acessada. `STORE_PRICE_LIST_MAPPING_STATUS = REQUIRED_BEFORE_C3` continua pendente.

## B.3-C2-R1 — native order foundation

Em 2026-09-03, a migration `20260903010000_native_order_foundation.sql` foi aplicada
uma única vez e exclusivamente ao `persi-staging` (`vtrujmhhkmvjzfklzxip`, PostgreSQL
17.6). O SHA-256 conferido antes do deploy foi
`2266b6c0235e1d43d69c9d6cb809a23b9222b72e1ef42a28d0ef196ac79e45cc`.

O backup oficial anterior à C2 está em
`D:\persi-backups\staging\20260903-092552-pre-native-order-b3c2`. Os cinco artefatos
totalizam 22.200.414 bytes, todos os hashes foram revalidados e o SHA-256 do manifesto
`checksums.json` é
`ec67fb5e880675b21d9c9ef91a1e188377d8a01a63639dd2d963ad32ed0ea79a`.
O dump registrou apenas os avisos esperados de FKs circulares em `categories`, `units`
e `carts`.

O preflight confirmou 21 migrations, C1 presente e C2 ausente. O dry-run selecionou
exatamente a C2, sem seeds ou roles. Depois do deploy, o histórico ficou 22/22 e um
novo dry-run retornou banco atualizado, sem migrations, seeds ou roles pendentes.

Foram criados somente cinco enums, as tabelas `orders`, `order_items`,
`order_addresses`, `order_adjustments` e `order_status_events`, seis funções, sete
triggers e dez policies. `stores` recebeu apenas `next_order_sequence bigint not null
default 1`, protegido por check positivo. A alocação de número é atômica; o vínculo
opcional com checkout é único; valores monetários autoritativos usam `bigint`; snapshots
e eventos são imutáveis; referências opcionais a produto e variante usam `ON DELETE
RESTRICT`; documento fiscal não é armazenado em plaintext.

RLS está habilitada em 5/5 tabelas. As dez policies são somente de leitura e limitadas
a `persi_app` e `persi_worker`; `anon`, `authenticated`, `public` e `persi_readonly` não
possuem acesso. Funções `SECURITY DEFINER` têm `search_path` vazio e execução pública e
browser revogada. As funções de checkout e de reserva/liberação/confirmação de estoque
permaneceram presentes e inalteradas.

As cinco tabelas C2 ficaram vazias. As contagens anteriores e posteriores permaneceram
idênticas: 3.080 produtos, variantes, preços e níveis de inventário; zero reservas e
movimentos; 2.323 sugestões PIM, um profile, três eventos de auditoria, 115 conflitos,
6.324 mídias e 12.902 mappings. Customer, cart, checkout e shipping também permaneceram
vazios. Nenhuma fixture foi criada remotamente.

A regressão local passou em 354/354 testes pgTAP, 24/24 testes estáticos das fundações
nativas e 10/10 testes de runtime. Em 20 ciclos por suíte, carrinho passou 60 cenários,
checkout passou 220 execuções em seis cenários sem overselling e order passou 360
execuções em quatro cenários, sem números duplicados, pedido duplicado por checkout ou
lost update. O runtime nativo continua desabilitado. Pagamentos, outbox, C3, providers,
WooCommerce, Olist e produção não foram alterados.

## B.3-C3-P1-R1 — store price authority foundation

Em 2026-09-03, a migration `20260903120000_store_price_authority_foundation.sql` foi
aplicada uma única vez e exclusivamente ao `persi-staging`
(`vtrujmhhkmvjzfklzxip`, PostgreSQL 17.6). O SHA-256 validado imediatamente antes do
deploy foi `d69f2f68cfd4f8bad33ada7fb6f58d1423b44abd1a73ea0c79a036cfef3f38c2`.

O backup oficial anterior à P1 está em
`D:\persi-backups\staging\20260903-201322-pre-store-price-authority-p1`. Os cinco
artefatos de schema, dados, roles e checksums totalizam 22.232.726 bytes. Todos os
hashes foram revalidados; o SHA-256 de `checksums.json` é
`7274d9cc3ea063782795f28338fb7ad0d9c3eb46c8e78b87ce5d8f46da0426b8`. O dump de
dados registrou somente avisos esperados de FKs circulares.

O preflight confirmou 22 migrations e ausência integral da P1. O dry-run selecionou
exatamente a P1, com zero seeds e zero roles. Após o deploy, o histórico ficou 23/23;
o dry-run final confirmou banco atualizado e nenhuma migration, seed ou role pendente.

A migration criou `commercial_context` apenas com `storefront_retail`, a tabela vazia
`store_price_list_assignments`, três funções, dois triggers e os índices e constraints
de identidade, versão, validade, moeda e snapshot. `price_lists` recebeu somente a
unicidade de `(id, currency)`. `checkout_sessions` recebeu os três campos de snapshot
de autoridade, checks de completude/versão positiva, FK composta e índice de consulta.

RLS está habilitada na nova tabela, sem policies. `public`, `anon`, `authenticated` e
`persi_readonly` não possuem acesso; `persi_app` e `persi_worker` não possuem DML de
configuração. Somente o resolver `SECURITY DEFINER`, com `search_path` vazio, pode ser
executado pelos dois papéis server aprovados. Os guards de histórico e checkout são
`SECURITY INVOKER`, sem execução pública/browser. O desenho permanece fail-closed,
sem fallback heurístico, com validade `[valid_from, valid_to)`, versões monotônicas,
proteção contra overlap e imutabilidade do snapshot após checkout pronto.

Antes e depois permaneceram: zero stores, assignments, customers, carts, checkouts,
orders, reservas e movimentos; 3.080 produtos, variantes, preços e níveis de estoque;
uma price list `woo-brl`, cobertura de 3.080 variantes e 186 sale prices; 2.323
suggestions PIM, um profile, três eventos de auditoria, 115 conflitos, 6.324 mídias e
12.902 mappings. Shipping permaneceu vazio. Nenhum dado comercial ou fixture remota
foi criado.

A regressão local passou em 391/391 testes pgTAP, 35/35 testes estáticos nativos,
10/10 testes de runtime e 23/23 testes de shipping. Inventory passou 50 ciclos sem
overselling. Em 20 ciclos por suíte, cart passou três cenários; checkout passou 220
execuções sem overselling; order passou 360 execuções sem duplicidade ou lost update;
P1 passou 160 execuções sem overlaps aceitos, versões duplicadas ou snapshots mistos.
Typecheck, build e `git diff --check` passaram; lint terminou com zero erros e cinco
warnings preexistentes. A suíte global ficou em 649/650 por uma expectativa conhecida
e fora do escopo em `tests/instagramFeed.test.mjs`.

Woo cart, checkout e order permanecem ativos e inalterados. Native cart, native
checkout, native order e o cutover de store price authority continuam desabilitados.
Nenhuma store Persi ou Loja do Gesseiro foi criada; nenhum assignment para `woo-brl`
foi criado. WooCommerce, PIM, Olist, providers, pagamentos e produção não foram
alterados.

## B.3-C3-P2-B — Persi store commercial bootstrap

Em 2026-09-03, o bootstrap comercial controlado foi executado uma única vez no
`persi-staging` (`vtrujmhhkmvjzfklzxip`, PostgreSQL 17.6), usando exclusivamente
`scripts/database/bootstrap-persi-store.mjs`. O SHA-256 confirmado foi
`440600afeb6789545959d113545d0ec4b4b943f880654327b859bac66de31bd9`.

O backup oficial imediatamente anterior está em
`D:\persi-backups\staging\20260903-212817-pre-persi-store-bootstrap`. Seus cinco
arquivos totalizam 22.245.337 bytes, os hashes foram revalidados e o SHA-256 de
`checksums.json` é `1a810b347520a691094e7746aeb70cd257648e8e69cd0036f55eb1b4b668d88e`.

O preflight e o recheck pós-backup confirmaram 23/23 migrations, zero stores e zero
assignments, a identidade exata de `woo-brl` e cobertura 3.080/3.080. A única tentativa
de apply confirmou `BOOTSTRAPPED`, em uma transação e com exatamente dois INSERTs.

A store UUID `7aaaa9ec-14e5-48f7-9de5-3630d92c5483` tem código `persi`, nome
`Persi Materiais de Construção`, status active, moeda BRL, timezone America/Sao_Paulo e
sequência inicial 1. O assignment UUID `846f4766-8aab-4889-a7a7-f6bd17fab830` liga a
store à lista `woo-brl` (`bc5547d9-b7ff-4714-84e4-c9cb149b7408`) em BRL, contexto
`storefront_retail`, versão 1, desde `2026-09-04T00:30:25.970Z`, sem término. O resolver
retornou exatamente essa autoridade. O dry-run posterior retornou
`ALREADY_BOOTSTRAPPED` e zero writes.

Somente stores e assignments mudaram de 0 para 1. Permaneceram idênticos: uma price
list; 3.080 preços, produtos, variantes e níveis de inventário; zero reservas,
movimentos e dados transacionais; 2.323 sugestões PIM, um profile, três eventos de
auditoria, 115 conflitos; 6.324 mídias; 12.902 mappings; shipping vazio.

Após limpar fixtures residuais exclusivamente no banco local, passaram 391/391 pgTAP,
48/48 testes focados/estáticos, inventory com 50 ciclos sem overselling e 20 ciclos de
bootstrap, P1, cart, checkout e order. O runtime nativo e o cutover permanecem
desabilitados. Produção, Woo, Olist, PIM, pagamentos, providers e shipping não foram
alterados. O excesso de DML em `stores` e o envelope seguro de PII continuam pendências
antes da ativação nativa.
