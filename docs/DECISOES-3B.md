# Decisões do Sprint 3B — rastreio de origem no site

Registro das escolhas feitas sem consultar o Eduardo (regra de autonomia do
plano) e dos motivos. Contrato com o painel: `docs/contrato-api-sites.md` do
repositório `persi-atendimento`. Guia do GTM: `docs/45-guia-gtm-rastreio.md`.

## 1. Onde mora o "pedido" — e por que não há migração SQL

O plano pedia uma coluna `jsonb origem` na tabela de pedidos do Native Commerce.
**Esse esquema ainda não existe**: o próprio `supabase/migrations/…shipping_core.sql`
registra "orders/payments nativos ainda não" existem. Os pedidos do site vivem no
**WooCommerce** (REST), criados por `createPendingOrder` com `meta_data`.

Decisão: a origem vai no **meta do pedido `_persi_origem`** (JSON, até 6 KB).
É o equivalente aditivo e reversível da coluna: não toca dados existentes, não
exige migração, e apagar o meta (ou simplesmente ignorá-lo) desfaz tudo. Pedidos
sem cookies de rastreio nascem exatamente como antes (teste cobre isso). Quando
o Native Commerce ganhar a tabela de pedidos, basta gravar o mesmo JSON na
coluna `origem jsonb` — o formato é o do contrato.

## 2. Consentimento

O site só tem **um** aviso de cookies (Concordo / Recusar, cookie
`persi_cookie_consent`), sem categorias. Decisão: **"accepted" vale como
consentimento de marketing**; qualquer outra coisa (recusou, ainda não
respondeu) vale como "sem consentimento". Não criei categorias novas nem mexi no
texto do aviso (é decisão de conteúdo/jurídica).

| | Com consentimento | Sem consentimento |
|---|---|---|
| Cookies `persi_ft` / `persi_lt` | 90 dias, completos (UTM + gclid/gbraid/wbraid/fbclid) | **só sessão**, só UTM/página/referrer |
| gclid, gbraid, wbraid, fbclid no link do WhatsApp | vão | **não vão** |
| `ga`, `fbp`, `fbc` | vão (se existirem) | **não vão** |
| Cookie de sessão `persi_sid` | sim | sim (identifica só a visita) |

Como a regra vale também no **servidor** (que relê os cookies ao gravar o pedido
ou enviar o formulário), cookie adulterado no navegador não faz um id de anúncio
passar sem consentimento. Aceitar no meio da visita completa o toque da mesma
visita com o gclid (que ficou em memória, nunca em cookie, até então). Recusar
depois de ter aceitado rebaixa os cookies para sessão.

Atributos dos cookies: first-party, sem `Domain` (host-only), `Path=/`,
`SameSite=Lax`, `Secure` em https (mesmo padrão do cookie de consentimento).
Não são `HttpOnly` porque o navegador precisa lê-los para montar o link.

## 3. Primeiro e último toque

- **Primeiro toque**: nasce na primeira visita (mesmo direta) e não muda.
- **Último toque**: só muda por visita com parâmetro de campanha (UTM ou id de
  clique) ou **referrer externo em sessão nova**. Visita direta nunca apaga a
  campanha. Referrer do próprio domínio (`persimateriais.com.br` e subdomínios,
  mais `NEXT_PUBLIC_TRACKING_DOMINIOS_PROPRIOS`) não conta — voltar do
  WhatsApp/checkout não é origem nova.
- A página de entrada é guardada **sem a query string** (a query pode conter o
  gclid).
- O link de WhatsApp usa o **último toque** (padrão do plano para relatórios).

## 4. Link rastreado de WhatsApp

- Componente único: `components/UI/LinkWhatsApp.tsx`. HTML do servidor já sai
  com `<base>/w/<codigo>` (sem parâmetros; funciona sem JS); depois da
  hidratação o `href` ganha os parâmetros, e é recalculado no clique.
- **Sem `NEXT_PUBLIC_WHATSAPP_LINK_CODIGO`, é o `wa.me` original.** Código com
  formato inválido também desliga o rastreio (nunca quebra o botão).
- Trocados (6): botão flutuante, rodapé, página de contato, calculadora de frete
  ("Falar com um consultor"), aviso de produto sem estoque, página 404 (era um
  `<button>` com `window.open`; virou link com o mesmo visual).
- **Não trocado de propósito:** `ProductGallery` (`https://wa.me/?text=…`) é o
  botão de **compartilhar o produto** com outra pessoa (abre a lista de
  contatos); não é contato com a loja e não deve ir ao painel.
- **Efeito colateral a saber:** o painel monta a mensagem inicial do WhatsApp.
  Os textos próprios que existiam (produto sem estoque levava nome e URL do
  produto; 404 e botão flutuante tinham saudação própria) deixam de ir **quando
  o rastreio está ligado**. O produto continua identificável porque o link leva
  `pg` (a página do produto) e o painel grava essa página. Sugestão ao painel:
  aceitar um parâmetro opcional `texto` no `/w/:codigo` para preservar essas
  mensagens (hoje o fallback `wa.me` continua com elas quando o rastreio está
  desligado).
- Evento `clique_whatsapp` no dataLayer em todo clique, mesmo sem rastreio.

## 5. Formulário de contato → painel

- Pelo **servidor** (`app/api/contact/route.ts`), com `after()` do Next: depois
  de responder ao visitante, sem esperar o painel. Timeout de 3,5 s, sem repetir,
  nunca lança; falha vai ao log com motivo e status, **sem dado pessoal**.
- Sai **depois** da validação e do reCAPTCHA (robô não vira lead), mas **mesmo
  se o e-mail do formulário falhar**: o lead é valioso e o painel deduplica
  quem reenvia (contrato, seção 2).
- O formulário atual **não tem caixa de aceite de marketing** nem telefone
  (campos: nome, e-mail, assunto, mensagem). Não inventei a caixa (é decisão de
  texto/jurídica): `consentimento_marketing` é **omitido** (= não consentiu). O
  esquema já aceita `marketingConsent?: boolean` para quando a caixa existir.
- Mensagem enviada como `[Assunto] texto`; `formulario: "Contato do site"`.
- Fora do escopo (ficam como próximo passo): newsletter, aviso de estoque e os
  dados do checkout (já viram lead pelo pedido).

## 6. IDs de GA4 e Pixel; GTM

- O site **não injeta** GA/gtag/Pixel. `NEXT_PUBLIC_GA4_ID` e
  `NEXT_PUBLIC_META_PIXEL_ID` (opcionais) só são oferecidos ao GTM como
  `ga4_measurement_id` e `meta_pixel_id` no dataLayer, **entre o consent default
  e o `gtm.js`** (para tags de Inicialização enxergarem). Só passam se tiverem o
  formato de um ID (o valor entra em script inline). Em branco: nada é empurrado.
- O ID do GTM continua `NEXT_PUBLIC_GTM_ID` (sem GTM, nada é carregado).
- **`page_view` de troca de rota**: `AnalyticsPageView` não foi alterado; testes
  garantem um único componente no layout, a trava `lastTracked` e que nenhum
  arquivo novo dispara `page_view`. O guia manda **desligar** o `page_view`
  automático da Tag do Google no GTM para não contar em dobro.
- Aviso de cookies: o site **já tinha** banner com Consent Mode v2 integrado;
  não criei outro. A variável `NEXT_PUBLIC_CONSENT_BANNER` não foi criada
  (não há banner novo para ligar/desligar).
- **Correção de um defeito existente** (`lib/analytics/consentMode.ts`): o
  `update` do consentimento chamava `window.gtag?.()`, mas o `gtag` só existe
  depois do script do GTM (`lazyOnload`). Quem já tinha aceitado em outra visita
  tinha o `update` perdido e ficava "negado". Agora vai direto à fila do
  dataLayer (como `arguments`, formato do gtag) e é aplicado depois do `default`.
  Teste cobre.

## 7. begin_checkout e purchase

- `begin_checkout`: `BeginCheckoutEvent` dentro de `CheckoutPageClient`, uma vez
  quando o carrinho carrega, enquanto o pedido não foi criado (a tela de
  Pix/boleto não repete). `value` = subtotal dos itens.
- `purchase`: `PurchaseEvent` na confirmação, **só quando o pedido está pago**.
  Trava por `transaction_id` em `localStorage` (+ trava de montagem se o
  armazenamento estiver bloqueado; o GA4 também deduplica). Para cartão, a tela
  não buscava os detalhes do pedido: agora busca (uma consulta a mais, falha
  tolerada) só para o evento levar `items`.
- `item_id` = SKU, senão id do produto — igual a `view_item`/`add_to_cart`.
  Para isso `getOrderConfirmationDetails` passou a devolver `productId` e `sku`
  (campos novos e opcionais).
- Limitação: Pix/boleto pagos depois de a pessoa sair do site não geram
  `purchase` (nasce no navegador). Fazer por servidor (Measurement Protocol)
  exigiria o secret do GA4 e o `client_id` no pedido — o `ga_client_id` já fica
  gravado em `_persi_origem`, então é um próximo passo possível.

## 8. Pedido para o painel (pago, pendente, cancelado)

- `pago: true`, `email` e `origem` agora acompanham o aviso de pedido pago
  (mensagem ao cliente inalterada: não mandei `cliente` nem `total_centavos` no
  pago).
- **Defeito encontrado e corrigido na trava "só quando MUDOU para pago":** a
  conciliação (`reconcilePaymentReference`) avisava **toda vez** que a cobrança
  estava paga — o banco reenvia webhook, a página de confirmação reconsulta e o
  cron reconcilia, então o mesmo pedido passava por ali várias vezes
  (`markOrderAsPaid` era idempotente, mas o aviso não). Agora o estado é lido
  **antes** de marcar (`isOrderAlreadyPaidFor`) e só a mudança avisa. Testes:
  reenviar 3 vezes avisa 1; pendente nunca avisa; cancelado avisa 1 vez.
  Risco residual: dois webhooks **simultâneos** (milissegundos) ainda podem
  avisar duas vezes — só fecharia com um registro no banco (decisão de
  arquitetura; o painel também limita por telefone).
- **Pendente e cancelado** (`pago:false`, status "Aguardando pagamento" /
  "Cancelado") estão implementados, mas **atrás de
  `PAINEL_NOTIFICAR_PEDIDO_PENDENTE=1`, desligado por padrão.** Motivo: o aviso
  de cliente por WhatsApp é a parte que não pode errar; um painel que ainda não
  conheça `pago:false` poderia tratar "Aguardando pagamento" como pedido comum e
  escrever ao cliente. Ligar só depois de o painel (v69+) estar no ar. O pendente
  leva `cliente` e `total_centavos` (lead com valor). Sai com `after()` depois da
  criação **e da conferência do total** (pedido cancelado por divergência de
  total nunca vira lead), só para pedido **novo** (reuso idempotente não repete).
  O cancelado sai da conciliação (webhook/cron/confirmação) e da recusa
  síncrona de cartão.
- Pedido sem telefone não avisa (o painel identifica pelo telefone).

## 9. Qualidade e testes

- Lógica pura em `lib/tracking/` (testada sem navegador) e `lib/painel/`.
  Testes novos: `tests/rastreio*.test.mjs` (rodam no `npm test`) e o ponta a
  ponta `tests/rastreio-e2e.mjs` (`npm run test:rastreio:e2e`, fora do
  `npm test` porque exige build, painel de mentira e navegador).
- Dois testes **existentes** foram ajustados por mudança de lugar, sem afrouxar
  o que provam: `productPageRegressions` (o script do GTM ganhou um ponto de
  interpolação `${IDS_PUSH}`) e `paymentsReconcile` ("sem telefone, sem aviso"
  agora mora em `lib/painel/pedido.ts`).
- Sem novas dependências.
- Falhas que **já existiam** na `main` (22 testes de `npm test`: histórico do PIM
  e "Home carrega feed em Suspense") continuam iguais e não têm relação com
  esta mudança.
