# Checkout — endereço, frete e cache

## Escopo

O checkout usa o WooCommerce Store API como fonte de verdade para endereço,
pacotes, taxas e totais. O front-end não calcula preço, desconto, imposto ou
frete.

## Fluxo

1. O cliente preenche os dados e aciona **Calcular entrega**.
2. `POST /api/checkout/customer` converte o contrato interno e chama
   `cart/update-customer`.
3. A resposta oficial substitui o carrinho local e apresenta todos os pacotes e
   taxas retornados.
4. A escolha de cada pacote chama `POST /api/checkout/shipping`, que encaminha
   `package_id` e `rate_id` para `cart/select-shipping-rate`.
5. O resumo sempre renderiza os totais monetários da resposta oficial.

Uma edição posterior no endereço invalida o estado sincronizado e exige novo
cálculo. Requisições antigas ou abortadas não podem sobrescrever a resposta mais
recente.

## Cart-Token

As rotas internas leem o cookie HTTP-only do carrinho, encaminham o
`Cart-Token` ao WooCommerce e persistem qualquer token renovado em todas as
respostas, inclusive erros conhecidos.

## Exclusões obrigatórias de cache

As seguintes rotas precisam permanecer dinâmicas, privadas e sem cache em todas
as camadas (Next.js, Hostinger/LiteSpeed e Cloudflare):

- `/checkout*`
- `/api/cart*`
- `/api/checkout*`
- `/wp-json/wc/store/v1/cart*`
- `/wp-json/wc/store/v1/checkout*`
- `/wp-json/wc/store/v1/batch*`

Política esperada nas rotas do front-end:

```text
Cache-Control: private, no-store, no-cache, max-age=0, must-revalidate
CDN-Cache-Control: private, no-store
Vercel-CDN-Cache-Control: private, no-store
```

No WordPress/LiteSpeed, a resposta também deve indicar `no-cache`. A validação
de isolamento deve ser repetida após qualquer alteração de CDN, plugin de cache,
WAF ou hospedagem.

## Privacidade de logs

Não registrar nome, e-mail, telefone, CEP ou endereço. Em desenvolvimento, os
logs podem informar apenas etapa, status HTTP e quantidade de pacotes/taxas.
