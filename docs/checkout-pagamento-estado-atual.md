# Checkout e pagamento: estado atual

Resumo do que existe hoje no fluxo de pagamento (cartão Mercado Pago/PagBank, Pix e boleto Inter). Código principal: `app/api/checkout/payment/`, `lib/commerce/`, `services/payments/`.

## O que existe

- **Limites de tentativa.** `POST /api/checkout/payment`: 10 por minuto por IP (a mesma chave de idempotência não conta de novo); acima disso, 429 "Muitas tentativas. Aguarde um minuto e tente de novo.". O IP vem só de `cf-connecting-ip`; sem ele o limite não se aplica e o aviso vai ao log. Além disso, no máximo 5 cartões recusados por pedido (carrinho): na 6ª tentativa, só Pix. A consulta `GET /api/checkout/payment/attempt` tem limite próprio de 60 por minuto por IP.
- **Nova chave após recusa.** Cartão recusado de forma definitiva gera chave de idempotência nova, sem recarregar a página, com a mensagem de recusa e o Pix em destaque. Em qualquer outro erro a chave é mantida (nunca há cobrança dupla).
- **Espera em processamento.** Se o servidor responde 409 (tentativa em PAYMENT_CREATING), o checkout não libera outro pagamento: consulta a mesma chave a cada 5 s por até 2 min. Depois disso mostra mensagem final com WhatsApp.
- **Retomada após F5.** A chave em uso fica na `sessionStorage` (30 min, sem dado pessoal). Ao reabrir o checkout, a tela consulta a chave antes de liberar pagamento: criado, recusado (fluxo da recusa), inexistente (libera) ou timeout.
- **Confirmação simples.** Se o F5 fez o Cart-Token do navegador ficar para trás, a chave da tentativa (pedido com menos de 30 min) vale só para devolver o desfecho e o número do pedido: "Pagamento confirmado! Pedido nº X…", sem dado pessoal e sem cookie. Com cookie certo ou conta logada, vai à página completa do pedido.
- **Regra estrita de "pago".** Só `approved` (Mercado Pago) e `PAID` (PagBank) contam; `authorized` fica pendente (as cobranças são criadas com `capture: true`). Antes de marcar pago, nova consulta ao gateway pelo id e conferência do valor da compra (`transaction_amount` / `amount.value`, sem juros do parcelamento) com o total do pedido ao centavo e da moeda (BRL; ausente = BRL com log `currency_assumed_brl`; outra moeda não marca pago). Inter: `valor.original` (Pix) e `valorNominal` (boleto); campo ausente não marca pago. Vale em webhooks, rota de status, página de confirmação e crons (`cardReconcile.ts`, `chargeEvaluation.ts`, `approvedCharge.ts`).
- **Após o pedido.** Cartão aprovado vira "Processando" na hora; os itens do carrinho são esvaziados (o token fica).
- **Rotina de pendentes** (`reconcile-stuck-payments`, só leitura nos gateways). Faixa A: pedidos travados em PAYMENT_CREATING sem cobrança guardada (até 24 h); sem cobrança há 30 min ou mais, o pedido vira falho. Faixa B: pedidos pendentes com cobrança guardada, até 5 dias, só marca pago. Pix expirado, boleto vencido e cartão recusado na faixa B só vão ao log. Pedidos de até 24 h entram em toda passada; de 1 a 5 dias, 1 vez por hora. Nunca cria, estorna nem repete cobrança.

## Variáveis de ambiente

- `PAGAMENTO_RATE_LIMIT` (padrão `1`; `0` desliga os limites, para staging).
- `CRON_SECRET`: segredo dos dois crons (cabeçalho `Authorization: Bearer <valor>`).
- Credenciais dos gateways (Mercado Pago, PagBank, Inter) e `WORDPRESS_URL`/Store API: ver `.env.example`.
- Avisos ao painel pós-pagamento, todos desligados por padrão: `PAINEL_NOTIFICAR_PEDIDO_PENDENTE`, `PAINEL_AVISAR_ANDAMENTO`.

## Crons (agendador externo, POST)

| Rota | Frequência | Função |
|---|---|---|
| `/api/cron/expire-pending-payments` | 15 min | Reconcilia pedidos com cobrança guardada; expira Pix/boleto vencidos |
| `/api/cron/reconcile-stuck-payments` | 10 min | Rede de segurança (faixas A e B acima) |

`reconcile-stuck-payments` aceita `?dryRun=1` (não grava nada) e `?all=1` (ignora a cadência por hora). Uma execução em andamento bloqueia outra (409).

## O que monitorar nos logs

- `[cron-reconcile-stuck-payments]`: `result: "paid"` indica pagamento que o webhook perdeu (se for frequente, o webhook do gateway está falhando); `unverified` com `reason` (`amount_mismatch`, `invalid_amount`, `currency_mismatch`); `error` repetido; `truncated: true` no resumo; `not_found_failed` inesperado.
- `[cron-expire-pending-payments]`: falhas ao reconciliar e `truncated`.
- `[checkout-payment]` e `[pagamento-cartao]`: "cobrança aprovada não confere com o pedido" (`reason`), "moeda não informada pelo gateway" (`currency_assumed_brl`), "falha ao marcar o cartão aprovado como pago", "carrinho não foi esvaziado por completo".
- `[rate-limit] IP de confiança não identificado…`: IP não vindo do Cloudflare; o limite por IP deixa de valer.
- Pedido "Processando" com tela presa em "confirmando", ou 429 em volume: revisar limites e a consulta de tentativa.
