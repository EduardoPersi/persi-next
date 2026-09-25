# Escopo mínimo do canário — Native Commerce

Status: **registro de decisões, nada implementado por este documento**.
Consolida, num único lugar, o que já foi decidido pelo dono ao longo deste
projeto sobre o que entra e o que fica fora do primeiro lote real de
pedidos nativos ("o canário"). Não substitui os documentos de design
detalhados — cada seção aponta para onde o detalhe técnico vive.

## 1. O que o canário precisa fazer (bloqueador)

| Item | Onde está desenhado | Status |
| --- | --- | --- |
| Carrinho e checkout nativos (produto → carrinho → checkout → PII → ready) | `gate3-native-cart-checkout-routes.md` | Implementado, testado em staging |
| Pagamento (Pix/boleto Inter, cartão Mercado Pago, Apple/Google Pay PagBank) | já processado 100% pelo Next.js antes deste projeto | Já existia |
| Sync Olist→site de catálogo/preço/estoque (direto, sem passar pelo Woo) | `olist-integration-design.md` §5 | Design aprovado, não implementado |
| Export de pedido pago site→Olist (outbox) | `olist-integration-design.md` §7 / `docs/database/82-*` | Design completo, não implementado |
| Estoque disponível = saldo Olist − reservas nativas − margem (0 por decisão) | `olist-integration-design.md` §6 | Design aprovado |
| Mapeamento SKU Olist↔nativo (derivado do Woo↔nativo, mesma SKU) | `olist-integration-design.md` §4 | Design aprovado, verificação numérica pendente |
| Cancelamento pelo cliente (só até faturar) | `order-cancellation-and-returns.md` | Decisão registrada, canal = WhatsApp nesta fase |
| Estorno financeiro (manual, painel do provedor, ≤24h úteis) | `order-cancellation-and-returns.md` §1 | Decisão registrada |
| Cancelamento vindo do Olist → reflete no site | `order-cancellation-and-returns.md` §5 | Decisão registrada, depende do sync acima |

## 2. O que o canário explicitamente NÃO precisa (adiado, não esquecido)

| Item | Fase | Por quê |
| --- | --- | --- |
| Estorno automático via API do provedor | Fase futura | Decisão do dono: manual nesta fase (`order-cancellation-and-returns.md` §1) |
| Evento `order.cancel` automatizado ao Olist | Fase 1+ | Cancelamento no canário é manual no painel do Olist (`order-cancellation-and-returns.md` §6) |
| Botão de cancelamento no site / página "Acompanhar pedido" | Fase 1+ | Canal do canário é WhatsApp, não autoatendimento |
| Devolução por arrependimento pelo site | Fase seguinte à Fase 1+ | Fluxo de logística reversa não desenhado ainda |
| Status/rastreio operacional do pedido (webhook Olist de situação) | Fase 2 do Olist | `olist-integration-design.md` §11 |
| Nota fiscal via native commerce | Fase 2 do Olist | Continua responsabilidade Woo/Olist até então |
| Cupom no checkout nativo | Gap separado, não coberto pelo Gate 3 | `gate3-native-cart-checkout-routes.md` |
| Frete (`shippingRequired: true`) | Gap conhecido do Gate 3 | Nenhum resolvedor de cotação nativo existe ainda |
| CNPJ/Inscrição Estadual no checkout | A confirmar com o dono se é necessário | `olist-integration-design.md` §7.1 |

## 3. Correção de escopo desta rodada

A Seção 6.3 de `olist-integration-design.md` havia classificado "construir
a chamada real de estorno nos três adapters de pagamento" e "resolver
`order.cancel` ao Olist" como **bloqueadores do canário**. A decisão do
dono registrada em `order-cancellation-and-returns.md` reverte os dois:
ambos passam a ser trabalho de fase posterior (Fase futura e Fase 1+,
respectivamente — Seção 2 acima), porque o cancelamento/estorno do canário
é 100% manual (WhatsApp + painel do Olist + painel do provedor). Isso não
muda nenhum código já entregue (Gate 3 permanece como está) — só a
prioridade e o momento de dois itens que antes pareciam bloquear o
primeiro pedido real.

## 4. Dependências externas ao dono (sem mudança nesta rodada)

Lista consolidada, já registrada em `olist-integration-design.md` §12 —
repetida aqui só como lembrete de que nada disso está resolvido:

- Acesso/plano da API do Olist para a integração nativa (própria, separada
  da que o Woo já usa).
- Confirmar API de estorno de cada provedor (Inter/Mercado Pago/PagBank) —
  relevante quando a fase futura de estorno automático for priorizada, não
  agora.
- Confirmar se a API de pedidos do Olist aceita cancelamento pós-criação —
  relevante na Fase 1+, não no canário.
- Validação jurídica/contábil da política de devolução (CDC art. 49) —
  `order-cancellation-and-returns.md` §3.
- Prazo de expiração do link "Acompanhar pedido" — `order-cancellation-and-returns.md` §8.

## 5. Backlog obrigatório antes do canário

Registrado em 2026-09-25, a partir de um sinal real em staging (não uma
suspeita teórica). **Nada disto foi implementado nesta rodada** — é
levantamento read-only para priorizar antes do primeiro pedido real.

### 5.1 Idempotência e rate limit em memória de processo — verificar contagem de processos na Hostinger

**Gatilho**: os logs de runtime de staging mostram **2 sequências de
inicialização do Next.js a cada restart**, sugerindo que a Hostinger pode
estar rodando **2 processos Node**, não 1.

**Por que isso importa**: cinco pontos do código guardam estado em memória
assumindo explicitamente "a Hostinger roda um único processo Node
persistente" — se isso for falso, esse estado **não é compartilhado**
entre os processos, e uma requisição repetida (retry de rede, duplo
clique) pode cair num processo diferente do que atendeu a primeira vez:

| Onde | O que guarda | Já assume processo único (citação) |
| --- | --- | --- |
| `lib/commerce/nativeCommerceIdempotency.ts:3-11` | Cache de idempotência do Gate 3 (`withIdempotency`) | "Same single-persistent-process assumption as lib/network/rateLimit.ts's createRateLimiter." |
| `lib/network/rateLimit.ts:4-6` | Rate limiter por IP (`createRateLimiter`) | "Limitador em memória de processo único (a Hostinger roda um único processo Node persistente)." |
| `lib/commerce/nativeCommerceRequestGuards.ts:37-39` | Duas instâncias do limiter acima, usadas pelo Gate 3 | "process-local (matches this app's single persistent Hostinger process)." |
| `services/payments/cronReconciliation.ts:105-108` + `app/api/cron/expire-pending-payments/route.ts:86-89` | Trava contra execução sobreposta do cron de reconciliação de pagamento | "Não protege contra múltiplas instâncias/processos do app rodando em paralelo; se isso mudar no futuro, substituir por um lock externo (ex.: registro em banco/Redis)." — **este comentário já previa exatamente este cenário** |

Dois documentos já registravam isto como pergunta em aberto, não fato
confirmado, antes mesmo deste sinal de staging:
`docs/database/09-local-development.md:38-39` ("Hostinger ainda exige
confirmar: ... processo persistente ou efêmero ... quantidade de
instâncias ... Nenhum deploy foi feito.") e
`docs/database/20-canary-readiness.md:27` ("Topologia documentada comprova
hospedagem Node na Hostinger, mas não comprova ainda um supervisor
persistente.").

**Confirmado nesta rodada (read-only, sem código alterado): a
idempotência de negócio crítica — pedido e pagamento — já está no banco,
independente de memória de processo**:

- `submit_native_checkout` — `orders.checkout_session_id` é `unique`
  (`20260903010000_native_order_foundation.sql:14`), e a própria função
  compara `idempotency_key`/`submission_request_hash` e devolve o pedido
  já existente em vez de duplicar (`20260905180000_native_checkout_atomic_submission.sql:227-332`).
- `create_native_payment_attempt`/`create_native_refund` — `unique
  (provider, idempotency_key)` real (`20260920000000_native_payment_ledger_foundation.sql:60,138`),
  `insert ... on conflict ... do nothing` — idempotência 100% no banco.
- `apply_verified_payment_transition` — trava por `for update` + `version`
  antes de qualquer transição, dedupe de evento por `unique (provider,
  external_event_id)` (`20260920000000_native_payment_ledger_foundation.sql:109`)
  — nenhuma dependência de memória de app.
- `checkout_sessions` (`unique(store_id, idempotency_key)`),
  `checkout_shipping_evidence` e `inventory_reservations` (ambas com
  `unique(idempotency_key)`) — mesma garantia.

**O que de fato depende só da memória de processo (risco real, se forem 2
processos)**:

- `add_native_cart_item`/`set_native_cart_item_quantity`/`remove_native_cart_item`
  — **não têm nenhuma chave de idempotência na assinatura SQL**
  (`20260905180000_native_checkout_atomic_submission.sql:84,103,123`).
  `add_native_cart_item` em particular **acumula** quantidade a cada
  chamada — um retry de rede roteado para o outro processo somaria a
  quantidade de novo, silenciosamente, sem erro nenhum. Este é o caso mais
  sério: o cache em memória (`nativeCartHandlers.ts`) é hoje a **única**
  proteção.
- `checkout:prepare` (`prepare_native_checkout`) — já tem idempotência no
  banco via `checkout_sessions_store_idempotency_unique`; o cache em
  memória aqui é reforço, não a única proteção — mais seguro.
- `checkout:pii` (`persist_checkout_pii`) — não tem chave de idempotência
  própria, usa controle de concorrência otimista por `expectedVersion` (a
  cada chamada bem-sucedida, `version` incrementa). Sem o cache em
  memória, um retry cross-processo **não duplicaria** o PII silenciosamente
  — falharia com `CHECKOUT_VERSION_CONFLICT` (a versão já teria mudado),
  um erro visível ao cliente, não uma corrupção silenciosa. Pior
  experiência, mas não um dado errado.

**Já existe no repositório um padrão Postgres pronto para reaproveitar**,
em vez de inventar um novo: `consume_admin_rate_limit`
(`supabase/migrations/20260912040000_distributed_admin_rate_limit.sql`) —
rate limit de janela fixa, gravado na tabela `admin_rate_limits`, já
independente de contagem de processos, já em uso real via
`lib/admin/rate-limit.ts`. Hoje só aceita operações administrativas
específicas (`admin.login`, `admin.mutation`, etc.) — generalizar para o
Gate 3 (rate limit por IP) e para `withIdempotency` (cache por
`scope:idempotencyKey`) é o trabalho a fazer, não reinventar o mecanismo.

**Ação antes do canário** (não feita agora):

1. Confirmar com a Hostinger (painel/suporte, não só pelos logs) quantos
   processos Node realmente rodam para este app.
2. Se for mais de um: mover `withIdempotency` e os rate limiters do Gate 3
   para armazenamento compartilhado (Postgres, no padrão de
   `consume_admin_rate_limit`) antes do primeiro pedido real —
   prioridade máxima para `add_native_cart_item` especificamente, por ser
   o único caso de corrupção silenciosa (não apenas erro visível).
3. Se for confirmado que é realmente um processo único (as "2
   inicializações" podem ter outra explicação — ex.: um único processo
   reiniciando duas vezes em sequência durante o deploy, não dois
   processos concorrentes): documentar a confirmação aqui e encerrar o
   item, sem migration nenhuma.

### 5.2 Fingerprint de PII — confirmado HMAC, não hash simples

**Confirmado nesta rodada (read-only)**: o `fingerprint`/
`destinationFingerprint` devolvidos ao cliente por
`POST /api/checkout/native/pii` são calculados por
`createCheckoutPiiFingerprint`/`createShippingDestinationFingerprint`
(`lib/commerce/checkoutPii.ts:192-198`), que chamam a função `hmac()`
interna (linha 187-190): `createHmac("sha256", key)...digest("hex")` — um
**HMAC-SHA256 real** (`node:crypto`), com `key` vindo de
`CHECKOUT_PII_HMAC_KEY` (nunca do conteúdo do PII em si). Isto **não** é
um hash simples do PII: sem a chave secreta, ninguém consegue calcular o
fingerprint de um PII conhecido/suposto (o que um hash simples permitiria,
por força bruta/tabela arco-íris) nem reverter o fingerprint de volta ao
PII original (HMAC é unidirecional). Devolver esse valor ao cliente que
acabou de enviar o mesmo PII é seguro — ele não aprende nada que não
soubesse, e o valor não é PII em si. Nenhuma mudança de código necessária;
item fechado por esta confirmação.

## 6. Referências

- [`gate3-native-cart-checkout-routes.md`](gate3-native-cart-checkout-routes.md)
- [`olist-integration-design.md`](olist-integration-design.md)
- [`order-cancellation-and-returns.md`](order-cancellation-and-returns.md)
- [`build-load-vs-production-woocommerce-risk.md`](build-load-vs-production-woocommerce-risk.md)
