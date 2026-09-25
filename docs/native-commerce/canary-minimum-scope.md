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

## 5. Referências

- [`gate3-native-cart-checkout-routes.md`](gate3-native-cart-checkout-routes.md)
- [`olist-integration-design.md`](olist-integration-design.md)
- [`order-cancellation-and-returns.md`](order-cancellation-and-returns.md)
- [`build-load-vs-production-woocommerce-risk.md`](build-load-vs-production-woocommerce-risk.md)
