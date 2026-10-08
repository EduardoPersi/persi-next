# Contrato site ⇄ CRM: carrinho abandonado e recuperação

Documento para a sessão do `persi-atendimento` implementar o lado do CRM. O
lado do site está em `persi-next` (etapas E2 a E4 do plano da Fase E).

Estado: **proposta aprovada em 08/10/2026**. Nenhuma flag está ligada em
produção.

## 1. Visão geral

```
cliente digita e-mail/WhatsApp no checkout
   └─► site ──(cart.updated)──► CRM guarda o carrinho do cliente
                                  CRM decide e manda a mensagem (se optin_whatsapp = true)
                                  CRM gera o link  https://persimateriais.com.br/r/<token>
cliente toca no link
   └─► site ──(recuperar)──► CRM devolve o carrinho guardado
       site recria o carrinho (só o que há em estoque, ao preço de agora)
cliente paga
   └─► site ──(pedido, pago:true, sessao)──► CRM encerra a recuperação
```

Tudo sai do **servidor** do site. O navegador nunca fala com o CRM e nunca vê
a chave.

## 2. Autenticação e regras comuns

- Cabeçalho `X-Site-Webhook-Key: <SITE_WEBHOOK_KEY>`, a mesma chave do
  `POST /api/webhooks/site/notificar` de hoje. HMAC fica para uma etapa futura.
- `Content-Type: application/json`. Só HTTPS.
- Tempo limite do site: 3,5 s para `cart.updated`, 5 s para `recuperar`. O site
  **nunca** espera o CRM para seguir: falha do CRM não derruba checkout nem
  pedido.
- Reenviar é seguro (idempotente). O site não repete em laço.
- Nunca viajam: CPF/CNPJ, endereço completo (rua, número, complemento,
  bairro), dado de pagamento, senha, token do carrinho do WooCommerce.
- Telefone: só dígitos, com DDI 55 (`5511987654321`). Valores em centavos
  (inteiros). Datas em ISO 8601 UTC.
- Retenção sugerida no CRM: apagar dados de carrinho não convertido em até 30
  dias (a validade do link).

## 3. `cart.updated`: site → CRM

`POST {PAINEL_URL}/api/webhooks/site/notificar`

Quando: o cliente informa um e-mail válido **ou** um WhatsApp de 10/11
dígitos no checkout, e a cada alteração relevante depois disso (itens,
contato, CEP, etapa, opt-in). Debounce de 800 ms no navegador; o servidor
descarta repetições idênticas por 60 s. Carrinho que fica vazio também é
enviado (`itens: []`).

```json
{
  "tipo": "carrinho",
  "evento": "cart.updated",
  "sessao": "9f2c1e…(64 caracteres hexadecimais)",
  "enviado_em": "2026-10-08T14:03:22.000Z",
  "contato": {
    "nome": "Maria Souza",
    "email": "maria@example.com",
    "telefone": "5511987654321"
  },
  "optin_whatsapp": true,
  "cep": "13201000",
  "cidade": "Jundiaí",
  "etapa": "entrega",
  "itens": [
    {
      "produto_id": 4821,
      "variacao_id": null,
      "sku": "CAN-PVC-25",
      "nome": "Cano PVC 25mm 6m",
      "quantidade": 2,
      "preco_centavos": 3490,
      "url": "https://persimateriais.com.br/produto/cano-pvc-25mm-6m",
      "imagem": "https://persimateriais.com.br/wp-content/uploads/cano.webp"
    }
  ],
  "total_centavos": 6980,
  "moeda": "BRL",
  "cupom": null,
  "origem": {
    "primeiro_toque": { "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "hidraulica" },
    "ultimo_toque": { "utm_source": "google", "utm_medium": "cpc", "utm_campaign": "hidraulica" }
  }
}
```

Campos:

| Campo | Regra |
| --- | --- |
| `sessao` | Hash SHA-256 (hex) do token do carrinho. Identifica o carrinho; **não** dá acesso a ele. Chave de upsert no CRM (por empresa + `sessao`). |
| `contato.nome` | Pode vir vazio. `email` e `telefone`: pelo menos um é válido. |
| `optin_whatsapp` | `false` quando o cliente desmarcou a caixa. **O CRM não envia recuperação** nesse caso (pode guardar o carrinho para estatística). |
| `etapa` | `perfil`, `entrega` ou `pagamento`: onde o cliente parou. |
| `itens` | Lista **completa** do carrinho (substitui a anterior). `variacao_id` é `null` em produto simples. |
| `total_centavos` | Soma dos itens menos descontos, como o carrinho mostra. Sem frete. Informativo: o site recalcula tudo ao recuperar. |
| `cupom` | Código do cupom aplicado, ou `null`. |
| `origem` | O mesmo objeto de origem que o `pedido` já leva (`primeiro_toque`, `ultimo_toque`, e com consentimento `ga_client_id`, `fbp`, `fbc`). O **servidor** lê dos cookies de origem, respeitando o consentimento; o navegador não manda UTM. Pode faltar. |

Respostas: `200 {"ok":true}` (também para repetição), `401` chave inválida,
`422 {"ok":false,"codigo":"…"}` corpo inválido, `429` limite. O site só
registra o status, sem dados pessoais.

## 4. Link de recuperação: CRM → cliente

O **CRM gera o token** e envia a mensagem:

- 32 bytes aleatórios em base64url (43 caracteres). O CRM guarda **só o hash
  SHA-256** do token, a empresa, a `sessao` e a validade de **30 dias**.
- Link: `https://persimateriais.com.br/r/<token>`.
- Um token por carrinho; novas mensagens podem reutilizá-lo até vencer.

## 5. `recuperar`: site → CRM

O CRM precisa expor:

`POST {PAINEL_URL}/api/webhooks/site/recuperar`

Cabeçalhos: `X-Site-Webhook-Key`, `Content-Type: application/json`.

```json
{ "token": "Qm9yYSBwcmEgY2Fycm8gZGUgdGVzdGUgY29tIDQzIGNhcmFjdGVyZXM" }
```

Sucesso, `200`:

```json
{
  "ok": true,
  "expira_em": "2026-11-07T14:03:22.000Z",
  "contato": {
    "nome": "Maria Souza",
    "telefone": "5511987654321",
    "cep": "13201000"
  },
  "itens": [
    { "produto_id": 4821, "variacao_id": null, "sku": "CAN-PVC-25", "quantidade": 2 }
  ],
  "cupom": "VOLTA10"
}
```

- `itens` vem do **último** `cart.updated` com itens. Sem preço: o site usa o
  preço de agora.
- `cupom`: código ou `null`. O site confere se é válido antes de aplicar.
- Chamar várias vezes é seguro. O CRM pode registrar "clicou no link" na
  primeira chamada.
- O site só chama este endpoint quando um **ser humano** abre o link. Robôs e
  a prévia de link do WhatsApp **não** chegam aqui.

Erros (o site trata todos da mesma forma: mostra "Esse link expirou, mas seus
produtos continuam na loja" e leva ao carrinho):

| Status | `codigo` | Quando |
| --- | --- | --- |
| 404 | `token_invalido` | Hash não encontrado. |
| 410 | `token_expirado` | Passou dos 30 dias. |
| 409 | `carrinho_convertido` | O pedido desse carrinho já foi pago. |
| 401 | `chave_invalida` | `X-Site-Webhook-Key` errada. |
| 429 | `limite` | Muitas consultas. |
| 5xx | — | CRM com problema. |

O CRM deve responder igual (mesmo corpo e tempo aproximado) para token
inexistente e expirado, para não revelar quais tokens existem.

## 6. Conversão: `pedido` pago com `sessao`

O aviso que o site **já envia** quando o pedido passa a pago
(`tipo: "pedido"`, `pago: true`) ganha um campo:

```json
{
  "tipo": "pedido",
  "telefone": "5511987654321",
  "pedido": "10482",
  "status": "Pagamento aprovado",
  "pago": true,
  "email": "maria@example.com",
  "total_centavos": 6980,
  "sessao": "9f2c1e…(o mesmo hash do cart.updated)",
  "optin_whatsapp": true
}
```

- `sessao` e `optin_whatsapp` são **opcionais**: pedidos antigos e painéis que
  ainda não conhecem os campos continuam funcionando.
- Ao receber `pago: true` com `sessao`, o CRM **encerra a recuperação** daquele
  carrinho (nenhuma mensagem nova; `recuperar` passa a responder
  `409 carrinho_convertido`).
- Sem `sessao`, o CRM pode casar por telefone ou e-mail dentro de uma janela
  curta.
- Pedido apenas criado (pendente) **não** encerra: só o pago.

## 7. Opt-in

Texto da caixa no checkout, marcada por padrão, junto do telefone:

> Quero receber atualizações do pedido e lembretes do meu carrinho pelo WhatsApp

- Marcada: `optin_whatsapp: true`.
- Desmarcada: `optin_whatsapp: false`. **Nenhuma** mensagem de recuperação.
- A escolha do cliente vale a cada `cart.updated`. Se mudar para `false`
  depois, o CRM interrompe o que estiver agendado.

## 8. Ligar e testar

Variáveis do site (somente servidor, sempre desligadas por padrão):

| Variável | Efeito |
| --- | --- |
| `PAINEL_ENVIAR_CARRINHO=0` | Com `0`, a rota `cart-signal` do site responde 204 e não chama o CRM. |
| `PAINEL_RECUPERAR_CARRINHO=0` | Com `0`, `/r/<token>` leva ao carrinho sem chamar o CRM. |

`PAINEL_URL` e `SITE_WEBHOOK_KEY` já existem. Para testar sem gravar, o CRM
pode aceitar `X-Persi-Teste: 1` (autentica e valida, sem gravar), como no
endpoint de leads.

Ordem sugerida no CRM: (1) receber `cart.updated`, (2) gerar o token e o
link, (3) endpoint `recuperar`, (4) encerrar pela `sessao` do pedido pago.
