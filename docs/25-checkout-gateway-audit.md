# Checkout — auditoria de gateways (Fase 4)

## Resultado observado

Em uma sessão isolada, com produto, endereço e frete válidos, o Store API
informou estes métodos disponíveis:

- `interpix`
- `interboleto`
- `wc_gerencianet_cartao`

O carrinho retornou `needs_payment: true`, `needs_shipping: true` e um pacote de
frete. A sessão foi limpa ao final. Nenhum pedido ou pagamento foi criado.

## O que esse resultado comprova

Os três IDs estão habilitados e passam pela verificação de disponibilidade do
WooCommerce para o carrinho auditado. Isso permite apresentar uma lista inicial
de meios disponíveis.

O resultado, sozinho, **não comprova**:

- suporte completo de cada plugin ao Checkout Block/Store API;
- campos e `payment_data` exigidos por cada método;
- processamento, retorno, redirecionamento ou webhook;
- idempotência e proteção contra pedidos duplicados;
- versão instalada dos plugins;
- compatibilidade entre as versões instaladas de WordPress, WooCommerce e
  plugins.

## Decisão arquitetural

Não implementar pagamento diretamente no headless enquanto a compatibilidade
dos plugins não for confirmada em ambiente administrativo/homologação.

A opção mais segura para a próxima etapa é um fluxo híbrido:

1. manter identificação, endereço, frete e totais no front-end Next.js;
2. transferir a sessão preservando o carrinho para o checkout WooCommerce
   homologado;
3. deixar os plugins atuais processarem Pix, boleto e cartão;
4. retornar ao front-end somente depois de validar pedido, pagamento e
   redirecionamentos ponta a ponta.

Uma implementação Store API totalmente headless só deve ser escolhida depois de
confirmar, para cada gateway, o contrato de `payment_data` e o suporte oficial
ou testado ao endpoint `POST /wc/store/v1/checkout`.

## Bloqueios para concluir a escolha

São necessários, no WordPress de homologação:

- nome e versão exatos dos plugins que registram os três IDs;
- documentação do fornecedor correspondente a essas versões;
- confirmação de registro no Payment Method Registry dos Blocks;
- formato esperado de `payment_data`;
- URLs de retorno e webhooks;
- credenciais de sandbox e procedimento de estorno;
- teste de Pix, boleto e cartão sem valor real;
- verificação de pedido duplicado e repetição segura após timeout.

## Limite desta fase

Esta auditoria não adiciona rota de criação de pedido, campos de cartão, chamada
ao endpoint de checkout ou integração de pagamento.

## Atualização — decisão revertida (2026-08-02)

A decisão arquitetural acima foi conscientemente revertida a pedido explícito
do responsável pelo projeto, ciente dos riscos e bloqueios listados nesta
página. O checkout passou a processar pagamento diretamente no headless:

- Banco Inter (Pix e boleto) via mTLS + OAuth2 client_credentials —
  `services/payments/inter/`.
- PagBank (cartão de crédito, Apple Pay, Google Pay) via tokenização no
  client e cobrança no servidor — `services/payments/pagbank/`.
- Pedido criado diretamente via `POST wc/v3/orders` (status `pending`),
  atualizado de forma idempotente após confirmação de pagamento —
  `services/woocommerce/orders.ts`.
- Endpoint de orquestração: `app/api/checkout/payment`. Webhooks:
  `app/api/webhooks/{inter,pagbank}`.

Os gateways nativos do WooCommerce (`interpix`, `interboleto`,
`wc_gerencianet_cartao`) e o script `tests/gateway-audit.mjs` que os
auditava foram aposentados — o fluxo de pagamento não passa mais pelo
checkout nativo do WooCommerce.

As preocupações de segurança e idempotência levantadas nesta auditoria
(webhook não confiável, pedido duplicado, confirmação de pagamento) foram
endereçadas na nova implementação: webhooks nunca tratam o próprio corpo como
fonte de verdade — sempre reconsultam a API do provedor antes de atualizar o
pedido (`services/payments/reconcile.ts`), e a criação de pedido/cobrança usa
uma chave de idempotência para evitar duplicidade.

Pontos que ainda dependem de confirmação em homologação/sandbox (não
resolvíveis só no código): mecanismo real de assinatura de webhook de cada
provedor, credenciais de sandbox, domínio de callback a cadastrar, e
confirmação de que `wc/v3/orders` recalcula corretamente preço/imposto/frete
a partir de `product_id` neste WooCommerce específico.

## Atualização — cartão de crédito migrado para o Mercado Pago (2026-08-27)

O método `pagbank_card` (cartão de crédito) foi substituído por
`mercadopago_card`, processado por `services/payments/mercadopago/` com o
mesmo padrão arquitetural do restante do checkout: tokenização client-side
(`mp.createCardToken` via SDK `https://sdk.mercadopago.com/js/v2`,
`components/Checkout/PaymentCardFields.tsx`), cobrança no servidor
(`POST /v1/payments` com `X-Idempotency-Key`), webhook em
`app/api/webhooks/mercadopago` que nunca confia no corpo — sempre reconsulta
`GET /v1/payments/{id}` antes de reconciliar o pedido
(`services/payments/reconcile.ts`).

**Apple Pay e Google Pay continuam no PagBank** (`pagbank_apple_pay`,
`pagbank_google_pay`, `services/payments/pagbank/`) — não fizeram parte
desta migração. O PagBank permanece integrado só para essas duas carteiras;
`scripts/generate-pagbank-public-key.mjs` e as variáveis `PAGBANK_*`
continuam necessárias para elas.

Assinatura de webhook (`x-signature`) do Mercado Pago não foi implementada,
pelo mesmo motivo dos webhooks do Inter/PagBank não terem: o corpo nunca é
fonte de verdade, a reconsulta à API já é a proteção real.

## Atualização — credenciais de teste configuradas, correção sobre prefixo (2026-08-27)

Credenciais de teste (`.env.local`, não versionado) foram configuradas:
`MERCADOPAGO_ACCESS_TOKEN` e `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY`, obtidas do
painel Mercado Pago em Suas integrações → [aplicação] → Credenciais de teste.
`CHECKOUT_CARD_ENABLED=true` e `CHECKOUT_CARD_ENVIRONMENT=sandbox` já
estavam configurados.

A premissa registrada na atualização anterior — que sandbox vs. produção se
distingue pelo prefixo do access token (`TEST-...` vs. `APP_USR-...`) —
estava **errada** para este projeto. A aplicação Mercado Pago usada aqui é do
tipo "Pagamentos online", cujas credenciais de teste também vêm no formato
`APP_USR-...` (vinculadas a um usuário de teste, não a uma conta real — foi
confirmado direto na tela "Credenciais de teste" do painel do Mercado Pago).
Não existe forma de distinguir sandbox de produção pela forma do token para
esse tipo de aplicação.

`lib/commerce/checkoutConfig.ts` foi corrigido: `sandboxConfigured` agora
depende só de `CHECKOUT_CARD_ENVIRONMENT=sandbox` mais a presença de um
token, sem checar prefixo. Isso remove uma camada de defesa que nunca
funcionou de verdade para este tipo de aplicação — na prática, o gate real
contra subir produção sem querer continua sendo `CHECKOUT_CARD_ENVIRONMENT`
+ `CHECKOUT_CARD_PRODUCTION_APPROVED`, ambos definidos manualmente pelo
operador. Ao migrar para produção, é preciso conferir manualmente que o
`MERCADOPAGO_ACCESS_TOKEN` colado é o de produção (mesma aba do painel,
"Credenciais de produção") — não há mais checagem automática de formato.

## Scripts operacionais

Scripts administrativos relacionados a pagamento, todos rodados com
`node --env-file=.env.local scripts/<arquivo>.mjs` (ou via `npm run <script>`).
Nenhum deles é chamado pelo app em runtime — são passos manuais de setup.

- **`scripts/register-inter-webhooks.mjs`** (`npm run register:inter-webhooks`)
  — registra a URL de webhook Pix (e tenta a de boleto) do Banco Inter a
  partir de `APP_BASE_URL`. Rodar ao configurar o ambiente e de novo sempre
  que o domínio do app mudar (ex.: troca do domínio de teste para o
  definitivo).
- **`scripts/generate-pagbank-public-key.mjs`**
  (`npm run generate:pagbank-public-key`) — gera a chave pública de
  **produção** do PagBank (`NEXT_PUBLIC_PAGBANK_PUBLIC_KEY`), chamando
  `POST {PAGBANK_API_BASE_URL}/public-keys` autenticado com
  `PAGBANK_CLIENT_SECRET`. **Só é necessário ao ativar produção de verdade
  com o PagBank** — em sandbox a chave pública é fixa e já vem documentada
  em `.env.example`, não precisa gerar nada. As chaves geradas não expiram,
  mas o PagBank recomenda renovar antes de completar 2 anos; o script
  imprime a data de geração para você guardar.
