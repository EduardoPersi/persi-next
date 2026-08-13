# Cloudflare — checkout WooCommerce híbrido

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
