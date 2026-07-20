# 06 — WooCommerce Headless

## Objetivo
Usar o WooCommerce como back-end e o Next.js como front-end.

## WooCommerce continua responsável por

- produtos
- estoque
- preços
- pedidos
- clientes
- cupons
- pagamentos

## WordPress continua responsável por

- mídia
- banners
- páginas
- descrições
- categorias
- marcas

## Organização

```text
services/
├── products
├── categories
├── brands
├── cart
├── checkout
└── customers
```

## Fluxo

Cliente → Next.js → API → WooCommerce → Next.js → Cliente

## Carrinho

Nunca confiar apenas nos cálculos do navegador.

Validar:
- preço
- estoque
- descontos
- frete

## Segurança

- usar variáveis de ambiente
- nunca expor secrets
- validar respostas
- tratar erros

## Integrações

Preservar:

- Bling
- Melhor Envio
- Banco Inter
- Google Merchant
- GA4
- GTM
- Cloudflare

## Evolução

A camada de serviços deve permitir trocar APIs futuramente sem alterar componentes visuais.
