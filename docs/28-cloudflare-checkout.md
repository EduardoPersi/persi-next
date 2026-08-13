# Cloudflare — checkout WooCommerce híbrido

## Reverse proxy no domínio público

O Worker versionado está em `cloudflare/persi-checkout-proxy/` e deve manter
somente a rota `persimateriais.com.br/checkout/*`.

Fluxo:

```text
POST Next /api/checkout-transfer
→ WordPress cria token de uso único
→ Next devolve /checkout/transfer?token=...
→ Worker converte para loja.../checkout/?persi_checkout_transfer=...
→ WordPress restaura e persiste a sessão
→ Worker converte cookies em host-only, Path=/checkout/
→ redirect para persimateriais.com.br/checkout/
```

O Worker também traduz, dentro desse namespace:

```text
/checkout/?wc-ajax=...       → loja.../checkout/?wc-ajax=...
/checkout/admin-ajax.php     → loja.../wp-admin/admin-ajax.php
```

Somente URLs funcionais de checkout são reescritas no HTML. Assets em
`loja.persimateriais.com.br/wp-content/` permanecem no backend. Todas as
respostas proxied recebem `Cache-Control: private, no-store, no-cache,
must-revalidate, max-age=0`.

Antes do deploy, publicar o Worker e confirmar no dashboard que a rota não
foi ampliada para `persimateriais.com.br/*`.

No `wp-config.php`, habilitar explicitamente o modo proxy:

```php
define( 'PERSI_HEADLESS_CHECKOUT_PUBLIC_CHECKOUT_URL', 'https://persimateriais.com.br/checkout/' );
```

Nesse modo, o plugin não redireciona `order-received` para a antiga rota Next
`/checkout/confirmacao`; o pedido recebido permanece sob o Worker.

## Causa raiz

O checkout clássico cria requisições `POST` na raiz do backend usando a query
`wc-ajax`. Uma regra de redirecionamento da raiz estava enviando essas chamadas
para `https://persimateriais.com.br/`, convertendo a resposta esperada do
WooCommerce em HTML do frontend e mantendo o loader ativo.

## Regra de redirecionamento

A regra que redireciona a vitrine WordPress deve executar somente quando todas
as condições abaixo forem verdadeiras:

```text
Hostname equals loja.persimateriais.com.br
Path equals /
Query string does not contain wc-ajax=
```

Expressão recomendada para uma Redirect Rule:

```text
(http.host eq "loja.persimateriais.com.br"
 and http.request.uri.path eq "/"
 and not http.request.uri.query contains "wc-ajax=")
```

No construtor visual, use a condição equivalente `Query String does not contain
wc-ajax=`. A regra deve preservar a query string nas navegações comuns. Nunca
redirecionar `POST` técnico nem converter seu método.

## Rotas que permanecem no backend

Estas superfícies não podem ser enviadas ao Next.js:

```text
/checkout/
/checkout/*
/carrinho/
/carrinho/*
/wp-json/*
/wp-admin/admin-ajax.php
/wc-api/*
/?wc-ajax=*
```

Também devem permanecer no backend todos os callbacks/webhooks documentados por
Banco Inter, PagBank e demais gateways ativos. Não liberar `/wp-admin/*` de
forma ampla; apenas `admin-ajax.php` e callbacks públicos explicitamente exigidos.

## Cache

Criar Cache Rules com `Bypass cache` para:

```text
URI path starts with /checkout/
URI path starts with /carrinho/
URI path starts with /wp-json/wc/store/
URI path starts with /wc-api/
URI path equals /wp-admin/admin-ajax.php
Query string contains wc-ajax=
```

Callbacks de pagamento também devem usar bypass. As respostas devem continuar
com `Cache-Control: private/no-store` quando emitido pelo WordPress.

## Validação

O teste crítico é:

```text
POST https://loja.persimateriais.com.br/?wc-ajax=update_order_review
```

Com sessão e nonce reais do checkout, deve retornar `200`, sem `Location`, sem
troca para `GET` e com JSON WooCommerce. Repetir para
`get_refreshed_fragments`, CEP, mudança de estado, cupons e gateways.
