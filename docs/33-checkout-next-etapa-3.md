# Checkout Next — Etapa 3

## Idempotência

O plugin `persi-headless-checkout` cria, somente na ativação/upgrade controlado, a tabela `wp_persi_checkout_attempts`. O índice `UNIQUE checkout_attempt_id` é a autoridade compartilhada entre todas as instâncias Next. O endpoint assinado `POST /wp-json/persi-headless/v1/checkout-attempt` oferece `reserve`, `get` e `transition`.

A reserva usa `INSERT IGNORE`; apenas o vencedor recebe um lease aleatório (somente o hash é persistido). Transições usam compare-and-swap por tentativa, estado atual e hash do lease. O lease expira em 90 segundos e pode ser assumido por outro processo para recuperar `RESERVED`, `ORDER_CREATED` ou `PAYMENT_CREATING`.

Estados: `RESERVED → ORDER_CREATED → PAYMENT_CREATING → PAYMENT_CREATED → PAYMENT_PENDING → PAYMENT_CONFIRMED|PAYMENT_FAILED`. Cancelamento é permitido antes da criação confirmada da cobrança. Não há regressões.

## Recuperação

- Pedido: o retry consulta `_persi_idempotency_key`; se o Woo já criou o pedido antes da queda, o mesmo pedido é persistido na tentativa.
- Pix: o `txid` é derivado da tentativa. Antes de criar, o adapter consulta `GET /pix/v2/cob/{txid}`; uma resposta perdida não causa um segundo Pix.
- Boleto: a API implementada no projeto só comprova consulta por `codigoSolicitacao`. Se o POST tiver sucesso e sua resposta se perder antes de persistir a referência, a tentativa permanece `PAYMENT_CREATING`; o retry não emite outro boleto e exige reconciliação operacional. Não foi presumida consulta por `seuNumero`.
- Com referência persistida, os endpoints server-side existentes consultam Pix/boleto novamente, sem depender exclusivamente do estado React.

## Carrinho

O pedido não limpa o carrinho. O `Cart-Token`, o carrinho Woo e o estado local são mantidos durante `PAYMENT_PENDING`, pois também protegem a retomada do convidado. A limpeza definitiva ocorrerá somente quando o pagamento for confirmado ou encerrado, em etapa de staging que valide a navegação de retorno. Refresh não cria outro pedido porque conserva o mesmo `checkout_attempt_id` e a tabela é única.

## Logs e dados

A tabela não armazena CPF, e-mail, telefone, endereço, segredo, cookie ou `Cart-Token`. Logs contêm apenas hash técnico abreviado da tentativa, pedido, método e estado. O adapter `PaymentGatewayAdapter` isola o Banco Inter da UI.

## Testes e staging

O teste concorrente executa 20 chamadas simultâneas, alternadas entre duas instâncias lógicas que compartilham a autoridade WordPress, e exige exatamente um pedido. Ele não cria cobranças reais. Antes de habilitar `CHECKOUT_MODE=next`, instalar/ativar a versão 0.6.0 do plugin em staging, confirmar a tabela e repetir o teste contra MySQL/WooCommerce reais.

## Rollback

Desabilitar o modo Next preserva o checkout híbrido. Reverter o plugin para 0.5.8 deixa a nova tabela inerte; não é necessário apagá-la. A remoção da tabela deve ser uma operação administrativa separada e não faz parte do rollback emergencial.
