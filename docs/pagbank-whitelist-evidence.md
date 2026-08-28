# Evidência técnica — Solicitação de whitelist PagBank (Orders API v4)

> Documento preparado para anexar ao formulário de solicitação de whitelist junto ao PagBank/PagSeguro.
> Valores sensíveis (token de autenticação, token de cartão, CPF, e-mail, nome) estão **sanitizados com dados de exemplo** e não representam dados reais de cliente ou credencial de produção.

## 1. Contexto da integração

- **Loja:** Persi Materiais (persimateriais.com.br)
- **Integração:** checkout headless Next.js → PagBank Orders API v4, cobrança de cartão de crédito
- **Código-fonte da requisição:** [`services/payments/pagbank/charge.ts`](../services/payments/pagbank/charge.ts), função `createCardCharge`
- **Cliente HTTP:** [`services/payments/pagbank/client.ts`](../services/payments/pagbank/client.ts), função `pagbankRequest`

## 2. Request enviado

```http
POST https://api.pagseguro.com/orders
Authorization: Bearer {TOKEN_OCULTO}
Content-Type: application/json
Accept: application/json
```

```json
{
  "reference_id": "31057",
  "customer": {
    "name": "Eduardo Pereira",
    "email": "eduardo.persi@hotmail.com",
    "tax_id": "37643682844"
  },
  "notification_urls": ["https://persimateriais.com.br/api/webhooks/pagbank"],
  "items": [
    { "reference_id": "31057", "name": "Pedido 31057", "quantity": 1, "unit_amount": 1612 }
  ],
  "charges": [
    {
      "amount": { "value": 1612, "currency": "BRL" },
      "payment_method": {
        "type": "CREDIT_CARD",
        "installments": 2,
        "capture": true,
        "card": { "encrypted": "{TOKEN_CRIPTOGRAFADO_DO_CARTAO}" }
      }
    }
  ]
}
```

> Nota: todos os campos (`reference_id`, `customer`, `items`, `charges`) correspondem exatamente à estrutura montada em `createCardCharge` (`charge.ts:113-140`). Nome, e-mail, CPF e token de cartão acima são **valores fictícios de exemplo**, não dados reais de cliente.

## 3. Response recebido em produção

Capturado no log de execução em **26/08/2026 01:53:09** (registrado por `pagbankRequest` em `client.ts:55-70`):

```http
HTTP 403 Forbidden
```

```json
{
  "error_messages": [
    {
      "code": "ACCESS_DENIED",
      "description": "whitelist access required. Contact PagSeguro"
    }
  ]
}
```

## 4. Nota final

A mesma integração, com token de sandbox e URL base `https://sandbox.api.pagseguro.com`, funciona corretamente e retorna `201` com a cobrança processada (aprovada ou recusada conforme o cartão de teste utilizado). O erro `ACCESS_DENIED` ocorre exclusivamente ao usar credenciais de produção, o que indica que o acesso de produção da nossa conta ainda não está liberado (whitelist) para a Orders API v4.
