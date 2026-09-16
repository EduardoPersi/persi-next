# Isolated Next.js Staging Runtime — Architecture & Provisioning Plan (A3.6-D1.5)

**Esta rodada é arquitetura e planejamento. Nada foi provisionado, implantado ou alterado remotamente.**

## C. Topologia atual (evidência real, não memória)

| Item | Valor | Confiança |
|---|---|---|
| Domínio produção | `persimateriais.com.br` (`APP_BASE_URL` default) | CONFIRMED |
| WordPress/Woo produção | `https://loja.persimateriais.com.br` (`WORDPRESS_URL` default) | CONFIRMED |
| Repositório | GitHub, branch `main` = produção | CONFIRMED (`docs/19-deploy-hostinger.md`) |
| Build/start | `next build` / `next start` | CONFIRMED (`package.json`) |
| Deploy trigger | Manual, sem CI/CD documentado | CONFIRMED |
| Hospedagem | Hostinger Cloud Professional | CONFIRMED (doc), mecanismo exato de injeção de env não detalhado |
| Ambientes existentes hoje | Um: produção | CONFIRMED |
| Precedente histórico de staging | WooCommerce/MySQL separado + 2 instâncias Next, para teste de concorrência de checkout | DOCUMENTED_BUT_STALE_POSSIBLE — capacidade provada no passado, disponibilidade atual desconhecida |
| Reverse proxy / Cloudflare | `TOKEN_CLOUDFLARE` existe (uso não confirmado como Access/proxy nesta auditoria) | UNKNOWN |
| Imagens remotas permitidas | `loja.persimateriais.com.br`, `secure.gravatar.com` (`next.config.ts`) | CONFIRMED |

## D. Classificação de confiança
`CONFIRMED` / `DOCUMENTED_BUT_STALE_POSSIBLE` / `UNKNOWN` aplicada em cada achado acima e ao longo deste documento.

## E. Topologia de staging recomendada

**Modelo recomendado: C — subdomínio + aplicação Node.js independente na mesma hospedagem Hostinger**, com processo, `working directory`, env e restart próprios. Modelos B (segunda instância no mesmo plano) e A (segunda aplicação) convergem para a mesma coisa na prática da Hostinger; a diferença exata depende da capacidade real do plano, que **não pode ser confirmada localmente**:

```
HOSTINGER_CAPABILITY_REQUIRES_MANUAL_VERIFICATION=YES
```

Ver checklist manual na Seção X.

## F. Hostname

```
PROPOSED_STAGING_HOSTNAME=staging.persimateriais.com.br
```

Alternativa se houver colisão ou preferência: `next-staging.persimateriais.com.br`. Nenhuma alteração de DNS feita ou verificada nesta rodada — a disponibilidade do subdomínio precisa ser confirmada manualmente no painel de DNS real.

## G. Controle de acesso

Sem evidência de Cloudflare Access já configurado (`TOKEN_CLOUDFLARE` existe mas seu propósito exato não foi confirmado nesta auditoria — pode ser um token de API genérico, não necessariamente Access). Duas opções, em ordem de preferência:

1. **Cloudflare Access** (se o domínio já for proxied pela Cloudflare — precisa verificação manual): melhor opção, autenticação antes mesmo de a requisição chegar à aplicação.
2. **Basic Auth via Next.js middleware** (portável, não depende de infraestrutura externa): um `middleware.ts` que verifica um header `Authorization: Basic` contra credenciais lidas de uma variável de ambiente (nunca hardcoded no repositório), aplicado a todas as rotas quando `PERSI_RUNTIME_ENV=staging`. Recomendado como fallback garantido se a opção 1 não puder ser confirmada.

**Nenhuma das duas foi implementada nesta rodada.**

## H. Isolamento de SEO

Camadas propostas (nenhuma implementada):
- `robots.txt` de staging servindo `Disallow: /` para todos os agentes.
- Header `X-Robots-Tag: noindex, nofollow, noarchive` em toda resposta (via middleware ou config do servidor), reforçando o robots.txt (que sozinho não é controle de acesso).
- `generateMetadata` retornando `robots: { index: false, follow: false }` explicitamente quando `PERSI_RUNTIME_ENV=staging`.
- Sitemap (`app/sitemap.ts`) não deve ser gerado/servido em staging, ou deve retornar vazio.
- Canonical: nunca apontar para o hostname de staging — se a lógica de canonical usar `APP_BASE_URL`, staging precisa ter seu próprio `APP_BASE_URL` para que canonicals gerados em staging apontem para si mesmo (nunca para produção por engano, nem vice-versa).
- Nenhum feed do Merchant Center deve ser gerado/enviado a partir de staging.

## I. Manifesto de variáveis de ambiente (classificado)

Auditoria completa de `.env.example` (achado real, categorizado). Nenhum valor foi lido ou registrado.

| Categoria | Variáveis (nomes) | Classificação staging |
|---|---|---|
| Woo/WP core | `WORDPRESS_URL`, `WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET` | STAGING_REQUIRED se leitura de catálogo real for aceita (ver Seção K); **secreto** as duas chaves |
| Sync webhook | `CATALOG_SYNC_WEBHOOK_SECRET` (usado em código, **ausente do `.env.example`** — achado do agente) | STAGING_REQUIRED, secreto, **deve ser um valor DIFERENTE do de produção** |
| Supabase/PIM | `DATABASE_URL`, `DIRECT_URL`, `ADMIN_SUPABASE_URL`, `ADMIN_SUPABASE_PUBLISHABLE_KEY`, `ADMIN_SESSION_HMAC_SECRET`, `ADMIN_RATE_LIMIT_HMAC_SECRET` | STAGING_REQUIRED, todas exceto a publishable key são secretas; **DATABASE_URL deve apontar exclusivamente para `vtrujmhhkmvjzfklzxip`** |
| PIM AI | `PIM_AI_*`, `OPENAI_API_KEY` | STAGING_OPTIONAL (fora do escopo do shadow); se usado, secreto |
| Catalog shadow (pré-existente) | `CATALOG_DATA_SOURCE`, `CATALOG_SHADOW_*` | STAGING_OPTIONAL, não-secreto |
| PIM shadow (A3.6) | `PIM_PUBLICATION_MODE`, `PIM_SHADOW_SAMPLE_RATE`, `PIM_SHADOW_TELEMETRY_SINK` | STAGING_REQUIRED, não-secreto, valores iniciais na Seção V |
| Checkout PII/tax | `CHECKOUT_PII_*`, `ORDER_TAX_DOCUMENT_*` | MUST_BE_DISABLED_IN_STAGING (checkout bloqueado nesta fase — ver L); todas secretas |
| Checkout mode/toggles | `CHECKOUT_MODE`, `CHECKOUT_PIX_ENABLED`, `CHECKOUT_BOLETO_ENABLED`, `CHECKOUT_CARD_ENABLED`, `CHECKOUT_CARD_ENVIRONMENT`, `CHECKOUT_CARD_PRODUCTION_APPROVED`, `CHECKOUT_WALLET_*` | MUST_BE_DISABLED_IN_STAGING nesta fase |
| Checkout concurrency harness | `CHECKOUT_STAGING_*` | STAGING_OPTIONAL — mecanismo de teste de concorrência pré-existente, não relacionado a isolamento geral; ainda cria pedido real no Woo, não usar para esta finalidade |
| Persi-headless HMAC (stock/newsletter/contact/checkout) | `PERSI_HEADLESS_*_HMAC_SECRET`, `*_ORIGIN`, `*_ENDPOINT`, `WORDPRESS_*_ENDPOINT` | MUST_BE_DISABLED_IN_STAGING ou apontar para instância isolada — todos os defaults são produção real |
| Pagamentos — Inter | `INTER_API_BASE_URL`, `INTER_CLIENT_ID`, `INTER_CLIENT_SECRET`, `INTER_CERTIFICATE_BASE64`, `INTER_PRIVATE_KEY_BASE64`, `INTER_PIX_KEY` | **MUST_BE_DISABLED_IN_STAGING — deixar em branco** (ver achado crítico, Seção L) |
| Pagamentos — PagBank | `PAGBANK_API_BASE_URL`, `PAGBANK_CLIENT_SECRET`, `NEXT_PUBLIC_PAGBANK_PUBLIC_KEY` | MUST_BE_DISABLED_IN_STAGING — deixar em branco |
| Pagamentos — Mercado Pago | `MERCADOPAGO_API_BASE_URL`, `MERCADOPAGO_ACCESS_TOKEN`, `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | MUST_BE_DISABLED_IN_STAGING — deixar em branco |
| Cron | `CRON_SECRET`, `APP_BASE_URL` | STAGING_REQUIRED, `APP_BASE_URL` **deve ser o hostname de staging**, nunca produção |
| OAuth social | `GOOGLE_*`, `FACEBOOK_*`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | STAGING_OPTIONAL — desnecessário para PIM shadow; se ligado, precisa de redirect URI próprio de staging registrado no provedor |
| Analytics | `NEXT_PUBLIC_GTM_ID` | **MUST_BE_DISABLED_IN_STAGING — deixar em branco** (carrega incondicionalmente se setado) |
| reCAPTCHA | `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_SCORE_*` | STAGING_OPTIONAL — desabilita graciosamente se ausente |
| Maps/Instagram | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `INSTAGRAM_*` | STAGING_OPTIONAL |
| Shipping — Melhor Envio | `SHIPPING_ME_*`, `MELHOR_ENVIO_*` | MUST_BE_DISABLED_IN_STAGING nesta fase (checkout bloqueado) |

Nenhum valor secreto foi lido, copiado ou registrado neste documento.

## J. Integrações externas — classificação de risco

| Integração | Classificação | Nota |
|---|---|---|
| Woo — leitura de catálogo (produtos/categorias/marcas/busca) | SAFE_READ_ONLY | Confirmado: funções `get*` não mutam nada |
| Woo — carrinho (Store API) | NEEDS_STAGING_CREDENTIAL ou MUST_DISABLE | Mutação de sessão efêmera, não cria pedido persistido — risco baixo, mas ainda toca o Woo real se apontado para produção |
| Woo — criação/atualização de pedido | **MUST_DISABLE** | `createPendingOrder`/`markOrderAsPaid`/`markOrderAsFailed` criam/alteram pedidos reais |
| Banco Inter (Pix/Boleto) | **MUST_DISABLE** — **achado crítico, sem gate algum hoje** | Nenhum double-gate como card/wallet; qualquer credencial configurada dispara cobrança real |
| PagBank (cartão/wallet) | MUST_DISABLE | Já tem double-gate (`CHECKOUT_CARD_ENVIRONMENT`+`_PRODUCTION_APPROVED`), mas simplesmente não configurar credenciais é mais seguro para esta fase |
| Mercado Pago (cartão) | MUST_DISABLE | Mesmo padrão do PagBank |
| WhatsApp | SAFE_READ_ONLY | Somente links `wa.me` client-side, nada é enviado pelo servidor |
| E-mail/SMS transacional | **MUST_DISABLE** (procedural) | Delegado ao WordPress via endpoints HMAC (contato/newsletter/stock/checkout); sem gate de ambiente — evitar submeter esses formulários durante os testes de staging |
| Analytics (GTM/GA4/Meta/Ads) | **MUST_DISABLE** | Carrega incondicionalmente se `NEXT_PUBLIC_GTM_ID` setado — deixar em branco em staging |
| Melhor Envio | MUST_DISABLE | Fora de escopo do shadow PIM |
| Webhook de sync de catálogo | NEEDS_STAGING_CREDENTIAL | `CATALOG_SYNC_WEBHOOK_SECRET` deve ser diferente em staging; webhook do Woo real não deve apontar para staging |

## K. Isolamento de mutação Woo

```
STAGING_WOO_MUTATION_ISOLATION_PASS=NO
```

Não existe hoje nenhum gate de ambiente nas funções de mutação (`cart.ts`, `orders.ts`, `contact.ts`, `newsletter.ts`, `stockNotifications.ts`). A leitura de catálogo (GET) é comprovadamente segura mesmo contra o Woo de produção real. Para a primeira fase (validação de infraestrutura do PIM shadow), a mitigação recomendada é **procedural + de escopo**, não um novo gate de código abrangente: **bloquear o checkout inteiro** (Seção L) elimina o ponto de criação de pedido; carrinho (mutação de sessão efêmera) é aceitável para navegação de PDP. Um gate de código formal (`PERSI_RUNTIME_ENV`-baseado, cobrindo todos os call sites de mutação) é recomendado como trabalho de uma rodada futura e dedicada antes de qualquer expansão do escopo de staging além de PDP/catálogo.

## L. Pagamentos e checkout — **achado crítico**

```
A3_6D15_PAYMENT_ISOLATION_PASS=NO (sem mudança de código nesta rodada)
```

**Banco Inter (Pix/Boleto) não tem NENHUM gate de sandbox/produção**, ao contrário de cartão/wallet que já têm double-gate (`CHECKOUT_CARD_ENVIRONMENT`+`_PRODUCTION_APPROVED`, `CHECKOUT_WALLET_ENVIRONMENT`+`_PRODUCTION_APPROVED`). Qualquer credencial Inter configurada em staging dispararia cobrança/Pix/boleto **reais**.

**Mitigação recomendada para a primeira ativação (zero mudança de gateway, zero mudança de código)**: simplesmente **não configurar** `INTER_CLIENT_ID`/`INTER_CLIENT_SECRET`/`INTER_CERTIFICATE_BASE64`/`INTER_PRIVATE_KEY_BASE64`/`INTER_PIX_KEY`, `PAGBANK_CLIENT_SECRET`, `MERCADOPAGO_ACCESS_TOKEN` em staging — deixá-las em branco. Como não há sandbox/produção distinguível por URL para nenhum desses três provedores, a única forma confiável de garantir zero cobrança real é a AUSÊNCIA da credencial (falha seca, sem chamada bem-sucedida possível).

**Decisão de checkout para esta fase** (Seção 14, opção A escolhida): **checkout completamente bloqueado**. Não é necessário para validar o PIM shadow (Seção 27), e elimina de uma vez os riscos de pagamento, ERP e e-mail transacional de pedido.

## M. Analytics

```
A3_6D15_ANALYTICS_ISOLATION_PASS=YES (via configuração, não código)
```
`NEXT_PUBLIC_GTM_ID` carrega o container **incondicionalmente** se setado (`components/layout/GoogleTagManager.tsx`). Mitigação: **não definir essa variável em staging**. Zero mudança de código necessária.

## N. Cache

```
A3_6D15_CACHE_ISOLATION_PASS=YES (por design de processo separado)
```
Cache do Next (`fetch`/`revalidateTag`/`unstable_cache`) é em memória do processo — um processo staging separado (Seção E) não compartilha cache com o processo de produção por construção. Ponto de atenção real: o webhook de sync de catálogo (`app/api/internal/catalog-sync/webhook/route.ts`) — o Woo de produção **não deve** ter esse webhook configurado para apontar para staging, e `CATALOG_SYNC_WEBHOOK_SECRET` deve ser diferente entre os dois ambientes.

## O. Mídia

Staging lendo imagens de `loja.persimateriais.com.br` (produção) via `next/image` é GET puro — `SAFE_READ_ONLY`. Nenhuma migração de imagem necessária nesta fase.

## P. Binding de banco (implementado nesta rodada)

`lib/pim/publication-runtime-preflight.ts::checkDatabaseBinding` (da D1) preservado. Adicionado: `isPimShadowSafeToRun()` — combina a checagem de binding com a decisão de segurança. **Escolha**: `DISABLE_PIM_SHADOW`, não `FAIL_STARTUP` — derrubar o processo staging inteiro por causa de um binding de banco incorreto seria desproporcional (mataria catálogo/PDP funcionando por um problema mais estreito), inconsistente com o padrão já estabelecido no projeto de falhas fechadas e localizadas (não um único fail-stop global). Conectado como uma camada de defesa adicional dentro de `runPimCatalogShadow`/`runPimCatalogShadowForList`, verificada **antes** do sampling e de qualquer acesso ao PIM — se `DATABASE_URL` não apontar para `vtrujmhhkmvjzfklzxip`, o efeito é idêntico a `mode=off` (zero leitura do PIM), independentemente do `PIM_PUBLICATION_MODE` configurado. Testado (`tests/pimA36D15DatabaseBindingGuard.test.mjs`).

## Q. Identidade de runtime e gate de startup

**Não existe hoje nenhum mecanismo para distinguir staging de produção** além de `NODE_ENV`, que é **inútil para isso**: `next start` exige build de produção, então `NODE_ENV=production` será idêntico nos dois ambientes — confirmado pela auditoria (cookie `__Host-persi_admin_capability` vs `persi_admin_capability`, flags `secure`, etc. dependem de `NODE_ENV`, todos avaliariam igual em staging e produção).

**Proposta** (não implementada nesta rodada): nova variável `PERSI_RUNTIME_ENV=staging|production`, lida uma vez no startup, usada por um futuro gate central para decidir: modo de checkout, presença de credenciais de pagamento, comportamento de robots/SEO, e qualquer guard de mutação Woo. Não duplica `NODE_ENV` — responde a uma pergunta diferente (qual ambiente lógico, não qual modo de build).

**Gate de startup proposto** (conceitual, Seção 20 da tarefa): no boot do processo staging, verificar (sem imprimir segredos): `PERSI_RUNTIME_ENV==="staging"`, `checkDatabaseBinding().matchesExpectedStaging===true`, ausência de credenciais reais de pagamento, `CHECKOUT_MODE` aponta para bloqueado/sandbox, `PIM_PUBLICATION_MODE` é um valor válido, `PIM_SHADOW_TELEMETRY_SINK` é um valor válido. Falha em qualquer item crítico → log de erro explícito no startup (não um crash silencioso, não uma tentativa de "consertar sozinho"). Não implementado nesta rodada — apenas `isPimShadowSafeToRun()` (escopo PIM) foi de fato codificado.

## R. Estratégia de branch/deploy

```
produção: main
staging: staging (ou deploy/staging)
```

Fluxo futuro:
```
feature/worktree → validação local → staging deployment branch → staging → qualificação → produção (autorização separada)
```
Evitar divergência permanente: `staging` deve ser regularmente atualizada a partir de `main` (fast-forward ou merge), nunca o inverso automático. Nenhuma branch remota foi criada nesta rodada.

## S. Isolamento de build/processo

Staging deve ter `working directory`, `.next`, processo Node e variáveis de ambiente completamente separados dos de produção — nenhum compartilhamento de diretório de build. Isso é uma consequência natural do Modelo C (Seção E), não uma implementação adicional.

## T. Isolamento de cookies

```
A3_6D15_COOKIE_ISOLATION_PASS=YES (já garantido estruturalmente, nenhuma mudança necessária)
```
Auditoria confirmou: **nenhum** cookie no projeto define `domain` explicitamente — todos são host-only por padrão (a opção mais segura). Os cookies mais sensíveis (`__Host-persi_jwt_session`, `__Host-persi_admin_capability` em produção) usam o prefixo `__Host-`, que o navegador **proíbe estruturalmente** de carregar `Domain` — proteção já embutida contra vazamento entre subdomínios, independente de qualquer configuração futura de staging.

## U. CORS/Origin

`validateMutationSource()` (`lib/account/validation.ts`) compara `Origin`/`Referer` contra `PERSI_HEADLESS_ACCOUNT_ORIGIN`, que teria de ser explicitamente setado para o hostname de staging para que mutações de conta funcionem lá — comportamento **seguro por padrão**: se não configurado, mutações de conta em staging falham (não são redirecionadas para produção). Nenhuma allowlist "permitir todas as origens" deve ser criada.

## V. Configuração inicial do PIM shadow em staging

Primeiro deploy deve subir com:
```
PIM_PUBLICATION_MODE=off
PIM_SHADOW_SAMPLE_RATE=0
PIM_SHADOW_TELEMETRY_SINK=noop
DATABASE_URL=<staging, vtrujmhhkmvjzfklzxip>
```
Somente após smoke test (D2) bem-sucedido: `mode=shadow`, `sample=1`, `sink=console`, sob autorização separada.

## W. Estado zero-published de staging (preservado, não alterado)
```
published=0
unpublished=8
```
Confirmado nesta rodada, read-only. A primeira ativação do shadow em staging validará apenas infraestrutura (Seção 27 da tarefa) — não qualidade de conteúdo PIM positivo, que exigirá uma fase de canário separada.

## Runbook de provisionamento futuro (10 gates, nenhum executado)

1. **Provisionar runtime** — criar a segunda aplicação Node.js (Modelo C), confirmando capacidade real da Hostinger (checklist manual, Seção X).
2. **Configurar hostname** — `staging.persimateriais.com.br`, apontar DNS, confirmar SSL.
3. **Proteção de acesso** — Cloudflare Access ou Basic Auth via middleware, antes de qualquer outra configuração.
4. **Env de staging** — aplicar o manifesto da Seção I; pagamentos/analytics/mensageria deliberadamente em branco/desabilitados.
5. **Binding de banco** — confirmar `DATABASE_URL` staging aponta para `vtrujmhhkmvjzfklzxip` via `checkDatabaseBinding()` no primeiro boot.
6. **Desabilitar escritas externas** — checkout bloqueado, mensageria não exercida, ERP fora de alcance.
7. **Deploy inicial com `mode=off`** — conforme Seção V.
8. **Smoke test** — home, categoria, PDP, busca (sem submeter formulários).
9. **Confirmar produção intacta** — nenhuma métrica/log/pedido de produção afetado.
10. **Qualificar D2** — só então uma nova rodada pode qualificar e (com autorização própria e separada) executar a ativação real do shadow a 1%.

## X. Checklist manual da Hostinger (não pode ser respondido localmente)

```
HOSTINGER_CAPABILITY_REQUIRES_MANUAL_VERIFICATION=YES
```

Perguntas exatas para verificar no painel real:
1. O plano atual permite uma **segunda aplicação Node.js** simultânea?
2. Um **segundo domínio/subdomínio** pode apontar para essa segunda aplicação de forma independente?
3. Variáveis de ambiente são **configuráveis por aplicação** (não compartilhadas globalmente)?
4. O **working directory** de cada aplicação é isolado?
5. **Restart** de uma aplicação afeta a outra?
6. **Logs** de runtime Node.js são separados por aplicação?
7. Existe suporte a **Cloudflare Access** para o domínio (o domínio já está proxied pela Cloudflare)?

## Y. Rollback do próprio staging

- `PIM_PUBLICATION_MODE=off` (reversível a qualquer momento, sem redeploy).
- Parar a aplicação staging (Hostinger) sem afetar produção (processos separados, Modelo C).
- Remover DNS de staging quando não for mais necessário (ação futura, fora do escopo desta rodada).
- Reverter para uma build/deploy anterior de staging sem qualquer relação com o histórico de deploy de produção.

## Bloqueadores residuais

1. `HOSTINGER_CAPABILITY_REQUIRES_MANUAL_VERIFICATION=YES` — a capacidade real do plano não pode ser confirmada localmente.
2. `PROPOSED_STAGING_HOSTNAME` não verificado contra DNS real.
3. `STAGING_WOO_MUTATION_ISOLATION_PASS=NO` — mitigado nesta fase por bloquear checkout inteiramente, mas um gate de código formal ainda não existe.
4. `PAYMENT_ISOLATION_PASS=NO` a nível de código (Inter sem gate) — mitigado operacionalmente por não configurar credenciais, mas o gate de código (paridade com card/wallet) é recomendado para uma rodada futura.
5. `PERSI_RUNTIME_ENV` e o gate de startup central são apenas propostos, não implementados.
