# P3-C-R1C-ISO - Local offline build validation

Data: 2026-09-05. Escopo local; sem staging, produção ou alteração de schema.

## Incidente e causa

O `next build` carrega `.env.local` automaticamente. A prerenderização da Home executou
`app/layout.tsx -> getMegaMenuData -> getAllProductCategories/getAllProductBrands ->
storeApiGetWithMeta -> Woo Store API` e `InstagramFeed -> getInstagramMedia -> Instagram
Graph API`. No incidente R1C houve tentativas Woo e uma leitura Instagram; nenhuma
escrita remota.

Outros clientes auditados incluem WordPress REST, Olist/importadores, Inter,
Mercado Pago, PagBank, Melhor Envio/ViaCEP, OpenAI e Supabase remoto. Variáveis que
podem habilitar integrações incluem apenas pelos nomes: `WORDPRESS_URL`,
`WOOCOMMERCE_CONSUMER_KEY`, `WOOCOMMERCE_CONSUMER_SECRET`, `INSTAGRAM_ACCESS_TOKEN`,
`INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`,
`INSTAGRAM_USER_ID`, `INTER_API_BASE_URL`, `INTER_CLIENT_ID`, `INTER_CLIENT_SECRET`,
`INTER_CERTIFICATE_BASE64`, `INTER_PRIVATE_KEY_BASE64`, `INTER_PIX_KEY`,
`PAGBANK_API_BASE_URL`, `PAGBANK_CLIENT_SECRET`, `MERCADOPAGO_API_BASE_URL`,
`MERCADOPAGO_ACCESS_TOKEN`, `MELHOR_ENVIO_ENVIRONMENT`, `MELHOR_ENVIO_CLIENT_ID`,
`MELHOR_ENVIO_CLIENT_SECRET`, `MELHOR_ENVIO_REDIRECT_URI`,
`SHIPPING_MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`. Nenhum valor foi lido, impresso ou documentado.

## Design

O modo canônico é `PERSI_OFFLINE_VALIDATION=1`, server-only e ausente por padrão.
`lib/server/externalIo.ts` implementa `assertExternalIoAllowed(provider)`, bloqueando
inclusive provider desconhecido. Woo Store/REST usam o guard; Instagram retorna
`EMPTY_DATA`. Os fallbacks existentes de menu, produtos e frete tratam o bloqueio.
Sem a flag, o caminho normal permanece inalterado.

Uma segunda barreira é injetada via `NODE_OPTIONS --import` em todos os subprocessos.
Ela intercepta `fetch`, `http.request/get` e `https.request/get`, permitindo apenas
`127.0.0.1`, `localhost` e loopback IPv6. Qualquer HTTP(S) externo falha antes do
socket com `EXTERNAL_NETWORK_BLOCKED`; unknown é bloqueado. Telemetry do Next é
explicitamente desativado. O runner também mascara no ambiente filho nomes de
credenciais, de modo que `.env.local` não consegue reativá-los.

Comandos PowerShell/Windows:

- `npm run build:offline`
- `npm run validate:offline`

## Fallbacks

- Woo/WordPress: `BLOCKED_WITH_HANDLED_FALLBACK` / listas vazias;
- Instagram: `EMPTY_DATA`;
- Olist, payments, shipping, OpenAI e Supabase remoto: `BLOCKED` antes de rede;
- endpoints Supabase/PostgreSQL locais: permitidos somente por loopback.

## Evidência

O teste direto para `external-example.invalid` foi bloqueado sincronamente sem DNS ou
rede. Um servidor HTTP sintético em `127.0.0.1` respondeu `LOCAL_OK`. O build real
compilou e prerenderizou 34 páginas com `.env.local` presente. Auditoria do build:

- operações Woo bloqueadas na aplicação: 107;
- operações Instagram bloqueadas/convertidas em vazio: 1;
- Olist/payment/shipping/OpenAI/remote Supabase/outros emitidos: 0;
- requisições externas reais totais: 0;
- escritas externas: 0.

Testes offline: 663/664, restando somente o baseline conhecido de
`InstagramCarousel` versus `InstagramCarouselLazy`. Typecheck PASS; lint zero erros e
cinco warnings conhecidos; build offline PASS. pgTAP 488/488 e matriz price/readiness
PASS, com fixtures revertidas. Hashes P3-A/P3-B/migrations 26/27 permanecem exatos e
27/27 migrations permanecem aplicadas. Nenhum reset foi executado.

Limitação: a proteção é process-scoped para comandos que usam o runner; comandos
comuns (`npm run build`) mantêm comportamento normal por desenho. Validações locais
que exigem garantia offline devem usar os comandos dedicados.
