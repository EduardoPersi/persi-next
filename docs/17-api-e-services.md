# 17 — API e Services

## Objetivo

Centralizar toda comunicação com o WooCommerce e demais integrações.

## Estrutura

```text
services/
├── api.ts
├── products.ts
├── categories.ts
├── brands.ts
├── cart.ts
├── checkout.ts
├── customers.ts
├── orders.ts
└── auth.ts
```

## Princípios

- Nunca chamar APIs diretamente nos componentes.
- Toda comunicação passa pela camada `services`.
- Retornos devem ser tipados.
- Tratar erros de forma consistente.

## Cache

Separar estratégias para:

- produtos
- categorias
- marcas
- estoque
- carrinho (sem cache)
- checkout (sem cache)

## Tratamento de erros

- Exibir mensagens amigáveis.
- Registrar erros inesperados.
- Não expor detalhes internos ao usuário.

## Integrações

Manter compatibilidade com:

- WooCommerce
- Bling ERP
- Melhor Envio
- Google Merchant Center
- GA4 / GTM

## Checklist

- Tipagem completa
- Tratamento de erros
- Sem lógica duplicada
- Fácil manutenção
