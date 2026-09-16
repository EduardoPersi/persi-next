# Staging Runtime Safety Gates (A3.6-D1.6)

**Esta rodada é implementação de código local. Nenhum ambiente foi provisionado, nenhuma variável remota foi alterada.**

## Identidade de runtime

`lib/runtime/runtime-environment.ts::getPersiRuntimeEnvironment()` — única fonte de verdade, nunca `process.env.PERSI_RUNTIME_ENV` espalhado pelo código. Valores: `production` (default se ausente/desconhecido — **compatibilidade obrigatória**: produção hoje não define essa variável, então nada muda para ela), `staging`, `development`, `test`. **Nunca `NODE_ENV`**: confirmado que `next start` sempre roda com `NODE_ENV=production`, tanto em staging quanto em produção — testado explicitamente (`NODE_ENV=production` + `PERSI_RUNTIME_ENV=staging` continua resolvendo para `staging`).

## Política de segurança central

`lib/runtime/runtime-safety-policy.ts::getRuntimeSafetyPolicy()` — 9 capacidades booleanas (`allowExternalWrites`, `allowWooMutations`, `allowPayments`, `allowTransactionalMessaging`, `allowErpWrites`, `allowCheckoutSubmission`, `allowShippingWrites`, `allowPublicIndexing`, `allowProductionAnalytics`) + `allowPimShadow`. Staging: todas `false` exceto `allowPimShadow`, que depende adicionalmente do binding real do banco (`isPimShadowSafeToRun`). Produção (explícita ou ausente): todas `true`, idêntico ao comportamento atual — **zero restrição nova introduzida em produção**, confirmado por teste de regressão (`getRuntimeSafetyPolicy({})` produz exatamente a mesma política que `getRuntimeSafetyPolicy({PERSI_RUNTIME_ENV:"production"})`).

## Inventário de efeitos colaterais e guards aplicados

| Integração | Ponto de guarda | Arquivo |
|---|---|---|
| Banco Inter Pix | `assertPaymentsAllowed` no topo de `createPixCharge` | `services/payments/inter/pix.ts` |
| Banco Inter Boleto | `assertPaymentsAllowed` no topo de `createBoletoCharge` | `services/payments/inter/boleto.ts` |
| PagBank (cartão/wallet) | `assertPaymentsAllowed` no topo de `createCardCharge` | `services/payments/pagbank/charge.ts` |
| Mercado Pago (cartão) | `assertPaymentsAllowed` no topo de `createCardCharge` | `services/payments/mercadopago/charge.ts` |
| Woo REST API v3 (pedidos: criar/atualizar) | `assertWooMutationAllowed` no ponto único `restApiWrite` (cobre `restApiPost`+`restApiPut`, usados por `orders.ts`) | `services/woocommerce/restClient.ts` |
| Woo Store API (carrinho: add/update/remove item, cupom, cliente, CEP) | `assertWooMutationAllowed` no ponto único `cartRequest` quando `method==="POST"` (GET/`getCart` não afetado) | `services/woocommerce/cart.ts` |
| Formulário de contato | `assertMessagingAllowed` em `submitContactMessage` | `services/woocommerce/contact.ts` |
| Newsletter (inscrição + confirmação/cancelamento) | `assertMessagingAllowed` em `subscribeToNewsletter` e `submitNewsletterToken` | `services/woocommerce/newsletter.ts` |
| Notificação de reposição de estoque (inscrição + confirmação/cancelamento) | `assertMessagingAllowed` em `subscribeToBackInStockNotification` e `submitStockToken` | `services/woocommerce/stockNotifications.ts` |
| Submissão de checkout (ponto de entrada) | `assertCheckoutSubmissionAllowed`, primeira instrução do handler, retorna 503 com mensagem segura em português | `app/api/checkout/payment/route.ts` |
| Conta (registro, esqueci senha, redefinir senha, login-guard) | `assertExternalWriteAllowed(..., "allowExternalWrites")` em qualquer chamada não-GET no ponto único `requestAccountEndpoint` | `services/account/client.ts` |

**Achados que não exigiram guard de código** (documentados, não ignorados):
- **Melhor Envio**: apenas `calculateShipment` (cotação) existe no código — nenhuma criação de remessa/compra de etiqueta/mutação de rastreamento existe hoje. Classificado `SAFE_READ_ONLY`, sem guard aplicado (bloquear cotação impediria testar a calculadora de frete sem necessidade).
- **Olist/ERP**: `"olist"` existe apenas como valor de enum em `lib/db/schema/core.ts`/`lib/server/externalIo.ts` — nenhuma chamada de API Olist real existe no código. Nada a guardar.
- **Webhooks outbound** (registro de webhook Inter): `scripts/register-inter-webhooks.mjs` é um script de deploy, não um caminho de runtime da aplicação — fora do escopo de um guard em runtime; documentado como requisito operacional (staging precisa registrar seus próprios webhooks contra seu próprio `APP_BASE_URL`).
- **`services/checkout/checkoutIdentity.ts`, `lib/commerce/checkoutAttempt.ts`, `lib/commerce/checkoutTransferClient.ts`**: usados exclusivamente dentro do fluxo de checkout, já bloqueado no ponto de entrada (`app/api/checkout/payment/route.ts`) — cobertura transitiva, sem necessidade de guard duplicado.

## Barreira genérica

`lib/runtime/external-write-guard.ts`: `assertExternalWriteAllowed({integration, operation}, policyField)` central + wrappers nomeados (`assertPaymentsAllowed`, `assertWooMutationAllowed`, `assertCheckoutSubmissionAllowed`, `assertMessagingAllowed`, `assertErpWriteAllowed`, `assertShippingWriteAllowed`). Lança `StagingExternalWriteBlockedError` (`code: "STAGING_EXTERNAL_WRITE_BLOCKED"`) — nunca revela configuração/credenciais, apenas os nomes de integração/operação fornecidos pelo chamador.

**Princípio do Section 10 aplicado literalmente**: mesmo que uma credencial real do Banco Inter seja configurada acidentalmente em staging, `assertPaymentsAllowed` lança **antes** de qualquer chamada de rede — provado por teste (`tests/paymentAndWooMutationGuards.test.mjs`, spies confirmando `called===false`).

## Mecanismo pré-existente não duplicado

`lib/server/externalIo.ts::assertExternalIoAllowed` já existe e responde a uma pergunta **diferente**: "estamos em uma execução de teste offline (`PERSI_OFFLINE_VALIDATION=1`)?" — sempre permite chamadas reais fora de testes, independentemente do ambiente. Os novos guards desta rodada respondem "este é um runtime de staging?" — complementares, não sobrepostos. Confirmado antes de implementar (Section 2: auditar antes de duplicar).

## SEO

`app/robots.ts`: quando `!allowPublicIndexing`, retorna `disallow: "/"` para todos os agentes, sem `sitemap`. `app/layout.tsx`: `metadata.robots = { index: false, follow: false, noarchive: true }` quando staging; produção mantém a forma exata de metadata anterior (sem chave `robots`).

## Analytics

`components/layout/GoogleTagManager.tsx`: `analyticsAllowed()` (via `allowProductionAnalytics`) guarda os dois exports — defesa em profundidade além de simplesmente deixar `NEXT_PUBLIC_GTM_ID` vazio (recomendação original da D1.5), cobrindo o caso de a variável ser herdada acidentalmente de produção.

## Controle de acesso (fallback local)

`lib/runtime/staging-access-guard.ts::isStagingBasicAuthValid` — Basic Auth, comparação `timingSafeEqual`, **fail-closed**: sem `PERSI_STAGING_BASIC_AUTH_USER`/`PERSI_STAGING_BASIC_AUTH_PASSWORD` configurados, acesso é sempre negado. Nenhuma credencial default existe no código.

Conectado em `proxy.ts` (arquivo de middleware desta versão do Next — nomeado `proxy.ts`, não `middleware.ts`, confirmado na documentação real do Next instalado), como a primeira verificação dentro de `proxy()`, ativa somente quando `isStagingRuntime()`. Matcher ampliado de `["/entrar", "/minha-conta/:path*", "/admin/:path*"]` para cobrir o site inteiro (exceto assets estáticos do Next), preservando `/admin/:path*` explicitamente por compatibilidade com um teste de segurança existente que documenta essa cobertura. **Produção**: `isStagingRuntime()` é `false` (variável ausente), então o novo bloco é pulado inteiramente e o restante da função se comporta exatamente como antes — confirmado por toda a suíte de testes de admin/conta permanecer verde sem alteração.

Nenhum endpoint de health check foi isentado — nenhuma evidência de um monitor de uptime real que precisasse disso; isenção não foi inventada.

Cloudflare Access continua a opção preferencial **futura** (Section 24) — este guard local não a substitui, é uma camada adicional que continua ativa mesmo se Access for adotado depois.

## Binding de banco (preservado, conectado à política)

`checkDatabaseBinding()`/`isPimShadowSafeToRun()` (D1/D1.5) preservados sem alteração de comportamento. `getRuntimeSafetyPolicy()` agora consulta `isPimShadowSafeToRun()` para popular `allowPimShadow` quando `runtime=staging` — mismatch de binding desativa o PIM shadow independentemente do `PIM_PUBLICATION_MODE` configurado, sem nunca imprimir `DATABASE_URL`.

## Diagnóstico seguro de startup

`lib/runtime/runtime-safety-status.ts::getRuntimeSafetyStatus()` — snapshot não-secreto (booleans + project ref do banco, nunca a URL/senha) para logs de startup/testes. Nenhum endpoint público criado.

## Regressão de produção

Confirmado por teste dedicado e pela suíte completa do projeto: introduzir `PERSI_RUNTIME_ENV` **não altera nenhum comportamento** quando a variável está ausente (o estado real de produção hoje). `1184/1185` testes passam após todas as mudanças desta rodada — a única falha é a pré-existente e não relacionada (`tests/instagramFeed.test.mjs`).

## `.env.example`

Adicionadas (sem valores reais): `CATALOG_SYNC_WEBHOOK_SECRET` (achado D1.5, usado em código mas historicamente ausente), `PIM_PUBLICATION_MODE`/`PIM_SHADOW_SAMPLE_RATE`/`PIM_SHADOW_TELEMETRY_SINK` (A3.6, também historicamente ausentes), `PERSI_RUNTIME_ENV`, `PERSI_STAGING_BASIC_AUTH_USER`, `PERSI_STAGING_BASIC_AUTH_PASSWORD`.

## Pendências para provisionamento real

1. `HOSTINGER_CAPABILITY_REQUIRES_MANUAL_VERIFICATION` — inalterado, esta rodada não resolve isso.
2. Nenhum ambiente real foi criado; `PERSI_RUNTIME_ENV=staging` nunca foi definido em lugar nenhum.
3. Um gate de startup central mais amplo (Section 26/27 da D1.5, além do escopo PIM) permanece proposto, não implementado como validação de boot — os guards já são fail-closed no ponto de uso, o que cobre o requisito de segurança sem exigir um processo de boot dedicado.
