# Restauração seletiva do checkout Next pelo histórico Git

## Commits de referência

- `dacc0a2` (`feat(checkout): process payments directly via Banco Inter and PagBank`, 2026-08-02): introduziu em conjunto a página Next, Pix, boleto, cartão PagBank, tokenização, pedidos Woo, status, webhooks e reconciliação. É o commit-base dos três métodos.
- `fd9d770`: corrigiu a geração local do QR Pix.
- `2bf8b10`: estabilizou reconciliação de pedidos e polling Pix.
- `eab4eb6` e `41c99ac`: corrigiram endpoint, resposta, CEP e mínimo do boleto Inter v3.
- `5b8d346` (`fix(checkout): generate boleto barcode/PDF reliably and hide unaffordable methods`, 2026-08-05): último marco funcional completo de boleto, PDF e polling.
- `9c265d1` (`debug(pagbank): log the actual error PagBank returns on a rejected charge`, 2026-08-09): último commit do checkout Next/PagBank antes de `58c0b1c` iniciar a transferência ao checkout Woo nativo.
- `e201b3d`: restaurou o checkout Next sobre a base atual e adicionou revalidação, cupom, idempotência compartilhada e retomada.

Assim, Pix, boleto e cartão nasceram no mesmo commit (`dacc0a2`); os commits posteriores acima são estabilizações específicas. O último estado Next completo usado para comparação é `9c265d1`.

## Diff semântico: histórico funcional → atual

### Preservado sem troca de gateway

- `services/payments/inter/client.ts` e `boleto.ts`: OAuth2/mTLS, endpoints e contratos históricos permanecem.
- `services/payments/pagbank/client.ts` e `charge.ts`: bearer token, criação/consulta de charge e `reference_id` permanecem.
- `PaymentCardFields.tsx`: SDK PagSeguro e tokenização no navegador permanecem.
- Webhooks Inter/PagBank, cron e categorização/reconciliação permanecem.
- Pix continua usando Next server → Banco Inter; PagBank continua Next server → PagBank.

### Melhorias aplicadas sobre o fluxo antigo

- tentativa estável e tabela MySQL com `UNIQUE(checkout_attempt_id)`;
- reserva HMAC e transições monotônicas;
- revalidação Store API de carrinho, estoque, variação, endereço, frete, cupom e total;
- comparação do total do pedido Woo antes do gateway;
- `coupon_lines` e `shipping_lines` autoritativas;
- recuperação Pix por `txid` determinístico;
- bloqueio de nova emissão ambígua de boleto ou cartão;
- confirmação recuperável por tentativa após refresh;
- preservação do carrinho enquanto o pagamento está pendente;
- logs sanitizados e dry-run anterior ao gateway.

## PagBank nesta fase

O código está restaurado, mas `.env.example` mantém `CHECKOUT_CARD_ENABLED=false` e `CHECKOUT_CARD_PRODUCTION_APPROVED=false`. Homologação pode ser ativada sem reescrever o checkout usando `CHECKOUT_CARD_ENABLED=true`, `CHECKOUT_CARD_ENVIRONMENT=sandbox` e uma URL PagBank reconhecidamente sandbox. Produção exige ainda `CHECKOUT_CARD_ENVIRONMENT=production` e `CHECKOUT_CARD_PRODUCTION_APPROVED=true`, após autorização comercial/técnica explícita.

Apple Pay e Google Pay continuam preservados, porém dependem de disponibilidade do navegador e dos contratos históricos ainda não homologados.

## Arquivos recuperados/preservados

`app/checkout/page.tsx`, rotas de payment/status/PDF/webhooks, todos os componentes `Checkout*`, resultados Pix/boleto, `PaymentCardFields`, clientes Inter/PagBank e serviços de pedidos Woo. Nenhum arquivo antigo foi copiado cegamente: o diff mostrou que os clientes/gateways históricos já permaneciam no HEAD; somente o fluxo público havia sido redirecionado e foi restaurado seletivamente.
