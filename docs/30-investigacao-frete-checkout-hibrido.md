# Investigação do frete no checkout híbrido

## Evidência reproduzida em 20/08/2026

Foi criada uma sessão efêmera sem pedido ou pagamento:

```text
Store API cart
→ produto simples público
→ transferência HMAC
→ /checkout/transfer
→ sessão WooCommerce no domínio público
→ update_order_review com destino BR/SP/CEP mascarado
```

Resultado técnico:

```text
checkout HTTP 200
update_order_review HTTP 200
result success
reload false
wp_woocommerce_session_* presente
woocommerce_cart_hash presente
woocommerce_items_in_cart presente
2 inputs shipping_method retornados
1 container checkout-shipping-options
0 containers de frete vazios
Content-Type application/json
sem Location
```

Isso comprova, para o produto e CEP testados, que o Worker preserva a request,
a sessão chega ao AJAX, o WooCommerce encontra destino/métodos e o Smart
Checkout recebe fragments com rates. A zona, os métodos e o plugin de frete não
falham de forma universal.

No cenário relatado pelo usuário, o mesmo endpoint retornou sucesso com o
container vazio. A diferença está antes da geração dos rates e aponta primeiro
para o `post_data` produzido pelo Smart Checkout, a atualização do WC_Customer
ou um filtro condicional por produto/package. Ainda não há evidência suficiente
para alterar Worker, zona ou plugin de frete.

Uma segunda tentativa diagnóstica recebeu HTTP 500 ao criar a transferência e
foi interrompida. Esse evento deve ser correlacionado com logs PHP/MySQL, mas não
prova relação com o desaparecimento do frete.

## Instrumentação 0.5.8

Habilitar temporariamente apenas durante uma reprodução controlada:

```php
define( 'PERSI_HEADLESS_CHECKOUT_DIAGNOSTICS', true );
```

O evento `checkout_request_diagnostic` no log WooCommerce informa:

- presença e destino mascarado no `post_data`;
- destino efetivo do WC_Customer;
- packages, zona, métodos habilitados e rates calculados;
- chosen shipping methods e cache do package 0;
- presença dos três cookies WooCommerce, sem seus valores;
- presença de `wp-content/object-cache.php`, sem reativá-lo;
- número aproximado de queries, tempo e memória;
- quantidade de prioridades registradas nos hooks de shipping.

Não executa `calculate_shipping()` novamente e não modifica sessão, zona,
métodos ou packages. Desabilitar a constante logo após capturar uma request real.

Artefato: `persi-headless-checkout.zip` 0.5.8, SHA-256
`A97B8591BF1575365760E15BF8E5F544E200DCB2B5FEA0694566EA8AF584C276`.

## Árvore de decisão do log

1. POST sem postcode/state/country: falha na serialização do Smart Checkout.
2. POST correto e WC_Customer vazio: falha na aplicação do endereço/sessão.
3. Customer correto e destination do package vazio: filtro de packages.
4. Destination correto, zona sem métodos: configuração/zone matching.
5. Métodos habilitados e zero rates: método/plugin de frete ou filtro de rates.
6. Rates presentes no log e fragment vazio: renderização do Smart Checkout.
