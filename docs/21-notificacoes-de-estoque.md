# Notificações de estoque

## Objetivo

O front-end permite que clientes solicitem um aviso para um produto sem
estoque. O Next.js apenas valida e encaminha a solicitação: o WordPress é
responsável por persistir a inscrição e enviar a mensagem quando o estoque
voltar.

## Configuração necessária no WordPress

O WordPress precisa oferecer um plugin ou extensão com:

- endpoint REST autenticado e seguro para receber inscrições do Next.js;
- associação entre e-mail, `productId` e, quando aplicável, `variationId`;
- disparo automático quando a quantidade voltar a ficar disponível;
- prevenção contra inscrições duplicadas e spam;
- validação e sanitização do e-mail;
- limitação de tentativas;
- registro do consentimento de privacidade e política de retenção compatível
  com a LGPD.

O endpoint deve retornar `2xx` no cadastro, `409` quando a mesma inscrição já
existir e códigos `4xx`/`5xx` coerentes em falhas. Nenhum código PHP ou plugin
do WordPress é criado por esta implementação.

## Configuração do Next.js

Defina apenas no servidor:

```dotenv
WORDPRESS_STOCK_NOTIFICATION_ENDPOINT=https://exemplo.com/wp-json/namespace/v1/stock-notifications
```

O navegador envia os dados para `POST /api/stock-notifications`. A rota valida
o corpo, aplica uma limitação básica em memória e encaminha ao WordPress sem
expor URL privada, credenciais ou tokens. A limitação em memória é apenas uma
proteção complementar; ambientes com múltiplas instâncias devem aplicar rate
limit compartilhado na infraestrutura e também no WordPress.

Sem `WORDPRESS_STOCK_NOTIFICATION_ENDPOINT`, o formulário continua visível,
mas o botão fica desabilitado e nenhuma confirmação falsa é exibida.

## Contrato enviado

```json
{
  "productId": 123,
  "variationId": 456,
  "email": "cliente@exemplo.com",
  "consent": true
}
```

`variationId` é opcional apenas para produtos simples. Para produtos
variáveis, a inscrição não pode ser feita até existir uma variação
selecionada.

## Limitação atual de variações

A seleção completa de variações da página de produto ainda não está
integrada ao identificador retornado pela Store API. Por segurança, o
formulário fica desabilitado nesses produtos e orienta o cliente a selecionar
uma variação. Ele não registra silenciosamente o produto principal.
