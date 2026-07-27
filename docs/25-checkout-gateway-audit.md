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
