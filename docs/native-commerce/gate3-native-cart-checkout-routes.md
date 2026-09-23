# Gate 3 — rotas nativas de carrinho e preparação de checkout

Status: **design, não implementado**. Aprovado pelo GATE_3 (Estratégia B):
nunca configurar credenciais Woo de escrita em staging; expor os
equivalentes nativos já existentes e testados via rotas HTTP novas.

Escopo desta fase: `produto → carrinho → checkout → submissão → pedido
nativo → reserva → payment attempt`, **sem** chamada a provedor de
pagamento (`PROVIDER_CALLS=0` — Gate 5 fica para depois). A rota final
`/api/checkout/native/route.ts` **não muda** — ela já existe, já foi
qualificada, e seu próprio gate (`isNativeCheckoutRuntimeEnabled()`,
hardcoded `false`) permanece intocado.

---

## a) Rotas novas (mínimas)

Todas as funções de banco abaixo já existem, já são chamadas via
`withPersiRole("persi_app", ...)` e já têm cobertura de teste
(`nativeCartFoundation.test.mjs`, `nativeCheckoutFoundation.test.mjs`,
`nativeCheckoutAtomicSubmission*.test.mjs`). Nenhuma delas tem hoje uma
rota HTTP — esse é o único gap real.

| Rota | Método | Função DB chamada | Observação |
|---|---|---|---|
| `/api/cart/native` | `GET` | `readNativeCart` (a criar — leitura simples, mesmo padrão de `readNativeOrder`) | Cria implicitamente se não existir? **Não** — GET nunca cria estado; ver `POST` abaixo. |
| `/api/cart/native` | `POST` | `createNativeCart` (`lib/db/nativeCart.ts`, já existe) | Idempotente por `(store, currency, owner)` — contrato já garantido pela própria função SQL. |
| `/api/cart/native/items` | `POST` | `addNativeCartItem` (já existe) | Idempotente por `(cart, variant)` — soma quantidade, nunca duplica linha. |
| `/api/cart/native/items/:id` | `PATCH` | `set_native_cart_item_quantity(p_cart_id,p_customer_id,p_guest_fingerprint,p_variant_id,p_quantity)` — **confirmado existente** (`supabase/migrations/20260907120000_native_cart_authority_null_safe.sql:24`, grant `persi_app`-only). Sem wrapper TS ainda — criar `updateNativeCartItemQuantity` em `lib/db/nativeCart.ts`, mesmo padrão de `addNativeCartItem`. |
| `/api/cart/native/items/:id` | `DELETE` | `remove_native_cart_item(p_cart_id,p_customer_id,p_guest_fingerprint,p_variant_id)` — **confirmado existente**, mesma migration, grant `persi_app`-only, retorna `boolean`. Sem wrapper TS ainda — criar `removeNativeCartItem`. |
| `/api/checkout/native/prepare` | `POST` | `prepareNativeCheckout` (`lib/db/nativeCheckout.ts`, já existe) | Recebe `cartId` + endereço; resolve preço/frete via `resolveStorePriceAuthority` (Postgres-nativo, sem Woo). |
| `/api/checkout/native/pii` | `POST` | `persistCheckoutPii` (`lib/db/nativeCheckoutPii.ts`, já existe) | Único ponto que recebe PII (nome/endereço/documento) — nunca logado (ver item h). |
| `/api/checkout/native/ready` | `POST` | `markNativeCheckoutReady` (já existe) | Última etapa antes da submissão; a partir daqui `expectedPiiFingerprint`/`expectedDestinationFingerprint` já existem para o `/api/checkout/native` de verdade consumir. |
| `/api/checkout/native` (submissão) | `POST` | `submitNativeCommerceCheckout` | **Sem mudança.** |

**Resultado da verificação (2026-09-23, leitura local do repo)**: ambas as
funções já existem, com os nomes reais acima — não são
`update_native_cart_item`/`remove_native_cart_item` (esses nomes não
existem), mas `set_native_cart_item_quantity`/`remove_native_cart_item`.
Nenhuma migration nova é necessária; o escopo desta fase **não precisa
ser reduzido** — alterar/remover item entra junto com criar/adicionar.

## b) Mapeamento produto (Woo) → variante nativa

A página de produto ainda lê do Woo (Store API, `wc/store/v1/products`) —
isso não muda nesta fase. O que falta é resolver, a partir do **ID do
produto Woo** que a página já tem, qual `product_variants.id` nativo
corresponde, para poder chamar `addNativeCartItem`.

**Chave estável já existente**: a tabela `external_mappings`
(`lib/db/schema/integrations.ts`), já usada pelo PIM/catálogo
(`services/catalog/postgres.ts`, `lib/pim/repository.ts`) com o padrão:

```sql
select internal_id from external_mappings
where system = 'woocommerce' and entity_type = 'product' and external_id = $wooProductId::text
```

`lib/pim/repository.ts` já tem inclusive uma query pronta para produtos
**sem** mapeamento (`not exists (... entity_type='product')`) — é
exatamente o mecanismo a reaproveitar para saber a cobertura real.

Para produtos **variáveis** (Woo `variations`), o mesmo padrão se aplica
com `entity_type = 'product_variant'` e `external_id` = ID da variação
Woo — precisa confirmar por leitura de schema/dados se esse mapeamento já
está populado para variações ou só para o produto-pai (produtos simples
provavelmente têm uma variante nativa implícita única).

**Resultado da consulta read-only em persi-staging (2026-09-23, transação
`READ ONLY`, só contagens agregadas, sem linhas individuais)**:

| Métrica | Valor |
|---|---|
| Total de produtos nativos | 3.080 |
| Produtos com mapping `woocommerce`/`product` | 3.080 |
| Produtos sem mapping | 0 |
| Mappings apontando para produto inexistente | 0 |
| Woo ID duplicado em 2+ produtos nativos | 0 |
| Produto nativo com 2+ Woo IDs mapeados | 0 |
| Produtos mapeados sem `product_variants` | 0 |
| Produtos mapeados sem preço ativo (`prices.status='active'`) | 0 |
| Produtos mapeados sem `inventory_levels` | 0 |

**Cobertura é 100%, sem duplicados, sem órfãos.** Os dois índices únicos
de `external_mappings` (`(system,entity_type,external_id)` e
`(system,entity_type,internal_id)`) já garantem 1:1 em ambas as direções
— a consulta confirmou isso empiricamente, não só por leitura do schema.
Não houve necessidade de HARD STOP.

**Contrato de falha fechada**: se `external_mappings` não tiver uma linha
`system='woocommerce', entity_type='product', external_id=<id>`, a rota
de adicionar-ao-carrinho retorna erro (ex.: `404 PRODUCT_NOT_MAPPED`) e
**não** cria um item de carrinho "provisório" ou com preço adivinhado. O
E2E desta fase deve ser testado primeiro com um punhado de produtos
manualmente confirmados como mapeados (SKUs conhecidos), não com o
catálogo inteiro.

## c) Identidade do carrinho guest

Reaproveitar o modelo de token já implementado em `lib/db/nativeCart.ts`
(`generateGuestCartToken`/`hashGuestCartToken`/`verifyGuestCartToken`,
já testado) — o token em si (32 bytes aleatórios, base64url) só precisa
de um transporte HTTP:

- Cookie **novo**, dedicado (não reaproveitar o cookie de carrinho Woo
  existente — são dois carrinhos diferentes, não podem se confundir):
  nome sugerido `persi_native_cart_token`.
- `HttpOnly`, `Secure` (sempre, mesmo em staging — já é HTTPS),
  `SameSite=Lax` (permite navegação normal entre páginas do próprio
  site; `Strict` quebraria retorno de redirecionamentos externos de
  pagamento mais adiante, mesmo que essa fase não chegue lá).
- **Sem rotação automática** nesta fase — o carrinho native tem
  `expiresAt` no próprio `createNativeCart` (parâmetro já existente); o
  cookie espelha essa expiração (`Max-Age` igual à janela do carrinho,
  ex. 30 dias, a confirmar com o valor já usado pelo carrinho Woo atual
  para manter a expectativa do usuário).
- Expiração/posse são validadas **sempre no servidor** via
  `canAccessNativeCart` (já existe, já testado) — o cookie só carrega o
  token puro; nenhuma decisão de autorização depende de o cliente
  "lembrar" nada além do token opaco.

## d) Segurança

- **Origin/CSRF**: nenhuma rota de mutação existente no repo tem um
  helper de Origin check dedicado (confirmado por busca) — as rotas de
  carrinho Woo atuais (`app/api/cart/*`) dependem só de serem
  same-origin por convenção de fetch do próprio frontend. Para as rotas
  novas, adicionar uma checagem explícita de `Origin`/`Referer` contra
  `APP_BASE_URL` (env já existente) antes de qualquer escrita — mudança
  pequena, não depende de biblioteca nova.
- **Rate limit**: reaproveitar `createRateLimiter` (`lib/network/rateLimit.ts`,
  já existe, já usado em outras rotas) — uma instância por rota de
  mutação, chaveada por IP.
- **Idempotency key**: toda rota de escrita (`POST`/`PATCH`/`DELETE`)
  exige um `idempotencyKey` (`z.uuid()`, mesmo padrão já usado em
  `/api/checkout/native`) — as funções SQL subjacentes (`create_native_cart`,
  `add_native_cart_item`) já são idempotentes por design; a rota só
  precisa repassar a chave, não inventar uma segunda camada.
- **Validação de entrada**: `zod`, reaproveitando o que já existe —
  `storeAddressSchema`, `customerPayloadSchema`, `shippingRatePayloadSchema`
  (`app/api/checkout/checkout-request.ts`) já cobrem endereço/frete;
  schemas novos só para `productVariantId`/`quantity` (carrinho) e para
  o corpo de PII, seguindo o `.strict()` já convencionado no repo.
- **Preço/frete nunca vêm do cliente**: a rota de `prepare` recebe só
  endereço/CEP; o preço e o frete são resolvidos server-side via
  `resolveStorePriceAuthority` e a lógica de frete já qualificada —
  igual ao contrato que `/api/checkout/native` já segue hoje (nenhum
  campo de preço/frete/status é aceito do corpo da requisição).
- **PII nunca em log**: mesma disciplina já aplicada em
  `nativeCheckoutPii.ts`/`/api/checkout/native` — a rota de PII só
  loga o evento (ver item h), nunca o conteúdo do payload.

## e) Gate de ativação (rotas novas, não a submissão)

Novo, separado do gate existente — arquivo sugerido
`lib/runtime/native-commerce-staging-routes.ts`, mesmo estilo de
`lib/runtime/native-checkout-mode.ts` (fail-closed por padrão,
independente de `NODE_ENV`):

```ts
export function isNativeCommerceStagingRoutesEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    environment.NATIVE_COMMERCE_STAGING_ROUTES_ENABLED?.trim() === "true" &&
    getPersiRuntimeEnvironment(environment) === "staging"
  );
}
```

- Produção nunca tem `PERSI_RUNTIME_ENV=staging` (ausência já resolve
  para `"production"`, per `lib/runtime/runtime-environment.ts`) —
  então mesmo que alguém sete `NATIVE_COMMERCE_STAGING_ROUTES_ENABLED=true`
  em produção por engano, a função retorna `false`. Isso vira teste
  obrigatório (`environment=production` + `NATIVE_COMMERCE_STAGING_ROUTES_ENABLED=true`
  ⇒ `false`), espelhando o teste que já existe para
  `isStagingRuntime()`/`getRuntimeSafetyStatus`.
- Cada rota nova começa com:
  ```ts
  if (!isNativeCommerceStagingRoutesEnabled()) {
    return new NextResponse(null, { status: 404 });
  }
  ```
  Desligado ⇒ 404 sem corpo, mesmo padrão de `/api/checkout/native`
  quando `isNativeCheckoutRuntimeEnabled()` é falso — nunca 503 com
  mensagem (evita vazar que a rota existe).
- **`isNativeCheckoutRuntimeEnabled()` não é tocado.** A submissão final
  continua bloqueada pelo seu próprio gate, hardcoded `false`,
  completamente independente deste novo gate — mesmo com as rotas de
  carrinho/preparo ligadas, `/api/checkout/native` continua 404.

## f) Identidade de execução

Todas as rotas novas chamam suas funções via `withPersiRole("persi_app", ...)`
— exatamente como `createNativeCart`/`addNativeCartItem`/`prepareNativeCheckout`
já fazem hoje (nenhuma mudança de role nelas). Nenhuma operação
privilegiada (`transition_native_payment_attempt`,
`apply_verified_payment_transition`, `reclaim_expired_native_reservations`)
é alcançável por essas rotas — elas continuam `persi_worker`-only,
inalteradas. Nenhum grant é relaxado; `lib/db/nativeCommerceAuthority.ts`
não é tocado nesta fase.

## g) Escopo do E2E desta fase

`produto (Woo, leitura) → resolver variante nativa (external_mappings)
→ criar/obter carrinho nativo → adicionar item → preparar checkout
(endereço/frete, preço server-side) → persistir PII → marcar pronto →
submeter (/api/checkout/native, já existente) → pedido nativo criado →
reserva de estoque → payment attempt criado`.

**Para nesse ponto.** Nenhuma chamada a Banco Inter/Mercado Pago/PagBank
nesta fase — `assertPaymentsAllowed` (já usado por `/api/checkout/native`)
continua sendo o freio; o Gate 5 (ativar de fato o provedor) é
trabalho futuro, separado.

## h) Observabilidade

Reaproveitar `lib/observability/nativeCommerceEvents.ts` — adicionar só
os nomes de evento que faltam para as novas etapas (seguindo o mesmo
enum fechado `NativeCommerceEventName` e o mesmo
`NativeCommerceEventFields`, que já é tipado para nunca aceitar um campo
com cara de segredo/PII):

```
native_cart_created
native_cart_item_added
native_checkout_prepared
native_checkout_pii_persisted   // nunca inclui o conteúdo, só checkoutId
native_checkout_marked_ready
```

Mesma disciplina já documentada no arquivo: `console.info`/`console.error`
com `[native-commerce] <evento>`, campos de identificador apenas
(`checkoutId`, `cartId`), nunca payload bruto.

## i) Plano de rollback

Desligar `NATIVE_COMMERCE_STAGING_ROUTES_ENABLED` (ou nem configurá-la)
no staging — todas as rotas novas voltam a 404 imediatamente, sem
precisar de redeploy nem reverter código. `isNativeCheckoutRuntimeEnabled()`
já garante que a submissão real nunca foi afetada em primeiro lugar.

---

## Fora do escopo desta fase (registrado, não resolvido aqui)

- Mapeamento de variações Woo (`entity_type='product_variant'`) para
  produtos variáveis — a consulta desta rodada cobriu só
  `entity_type='product'`; não confirmado se cada variação individual
  tem seu próprio mapping ou se o catálogo atual não usa produtos
  variáveis. Verificar antes de expor variantes múltiplas por produto.
- Ativação de provedor de pagamento (Gate 5).
- O risco de "Store API 500" sob carga de build — ver nota separada em
  `docs/native-commerce/build-load-vs-production-woocommerce-risk.md`.
