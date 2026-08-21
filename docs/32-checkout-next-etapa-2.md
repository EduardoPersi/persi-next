# Checkout Next — Etapa 2

## Estado

O checkout Next foi restaurado atrás de feature flag. O padrão continua sendo
`hybrid`, portanto esta alteração não muda produção por si só.

```env
CHECKOUT_MODE=hybrid
CHECKOUT_PIX_ENABLED=true
CHECKOUT_BOLETO_ENABLED=true
CHECKOUT_CARD_ENABLED=false
```

Com `CHECKOUT_MODE=next`, `/checkout` renderiza a aplicação Next. O rollback
continua disponível em `/checkout/hybrid`, usando checkout-transfer e o plugin
Persi existente.

## Fronteira comercial

- Carrinho, cliente, endereço, frete e cupons usam WooCommerce Store API sem cache.
- Cupons são aplicados/removidos pelos endpoints oficiais e enviados ao pedido.
- O servidor recupera novamente o carrinho e os produtos antes do pedido.
- A cobrança usa o total do carrinho Woo, sem desconto percentual calculado no Next.
- Depois de criar o pedido, o total retornado pelo Woo é comparado ao valor da
  cobrança. Em divergência, o pedido é cancelado e nenhuma cobrança é criada.
- O Cart-Token não é apagado ao criar a cobrança, permitindo retomada.

## Banco Inter: decisão provisória

O código dos plugins que registram `interpix` e `interboleto` não está neste
repositório. Sem as classes, versões, `process_payment`, metadados e callbacks
reais, não é seguro criar um adaptador por suposição. A Etapa 2 mantém a
arquitetura disponível no repositório: Next server → API Banco Inter por mTLS.

Antes do staging é obrigatório obter os arquivos/versões dos gateways instalados
na Hostinger e decidir se a arquitetura B pode substituí-la sem hack de terceiro.

## Bloqueio de staging

A idempotência atual reutiliza uma chave estável no browser e pesquisa pedidos
por meta no WooCommerce. Isso protege retry comum, mas a sequência pesquisa/cria
não é atômica entre duas instâncias Next. A garantia exigida de exatamente um
pedido demanda uma reserva única no banco WordPress (endpoint Persi) ou outro
armazenamento compartilhado com unicidade. Não foi simulada como se estivesse
resolvida por um lock apenas em memória.

Até essa reserva atômica existir e passar no teste concorrente, o status é:

```text
READY FOR STAGING: NÃO
```

## Cloudflare

Não houve alteração automática. Antes de testar `CHECKOUT_MODE=next` pelo
domínio público, retirar temporariamente a Worker Route:

```text
persimateriais.com.br/checkout/*
```

O Worker e o plugin não devem ser removidos. Para rollback, definir
`CHECKOUT_MODE=hybrid` e reativar a Worker Route.

## Teste leve

O script `npm run test:checkout:load` executa uma única passagem, sem criar
pedido ou cobrança. Exige uma sessão de staging explicitamente fornecida em
`CHECKOUT_SMOKE_COOKIE`; nunca registrar esse valor.
