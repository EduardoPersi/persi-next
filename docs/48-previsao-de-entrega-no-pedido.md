# Previsão de entrega no pedido (fase 7 do painel, lado do site)

O checkout mostra ao cliente quando o pedido chega ("Chega hoje", "Chega amanhã,
dia 9"). O painel de atendimento (persi-atendimento) usa **essa mesma data** para
encaixar a entrega da loja, em vez de ter um corte próprio.

## O que o site faz

1. **Na criação do pedido** (`app/api/checkout/payment/route.ts`), se o frete
   escolhido é da loja (`classificarEnvio` = `loja`), calcula a data com
   `arrivalDateForRate` (`lib/shipping/calendar`: corte 13h / sábado 10h30,
   feriados, zonas) e a grava em dois metas do pedido do WooCommerce.
2. **Nos avisos ao painel** (`lib/painel/pedido.ts`), os eventos **pendente**,
   **pago** e **cancelado** leem os metas e mandam `envio.previsao_entrega`. A
   data **não é recalculada**: o Pix pago às 13h05 por quem viu "Chega hoje" às
   12h55 continua com a data que o cliente viu. O boleto pago dias depois também
   manda a data congelada; **quem decide o dia real é o painel**.

## Metas do pedido (nome documentado)

| Meta | Valor |
| --- | --- |
| `_persi_previsao_entrega` | `AAAA-MM-DD` (data civil de São Paulo) |
| `_persi_previsao_calculada_em` | ISO 8601 em UTC, de quando foi calculada |

O pedido nativo (Supabase) grava o mesmo dado: ver
`docs/database/06-orders-payments.md`, "Previsão de entrega prometida".

## Chave

`PAINEL_ENVIAR_PREVISAO_ENTREGA=1` liga **as duas pontas** (gravar os metas e
mandar o campo). **Desligada por padrão**: sem ela o pedido nasce sem meta e o
aviso é idêntico ao de antes. Pedidos criados com a chave desligada nunca terão a
previsão (não há de onde tirá-la), e seguem sem o campo.

Ordem para ligar: (1) painel com a v79 no ar; (2) `PAINEL_ENVIAR_PREVISAO_ENTREGA=1`
no ambiente do site; (3) novo build/restart.

## Payload (pedido pago, entrega da loja, Jundiaí, Pix)

```json
{
  "tipo": "pedido",
  "pedido": "4512",
  "telefone": "11988887777",
  "status": "Pagamento aprovado",
  "pago": true,
  "cliente": "Maria Souza",
  "email": "maria@exemplo.com.br",
  "cpf_cnpj": "12345678909",
  "total_centavos": 20940,
  "endereco": {
    "destinatario": "João Souza", "cep": "13201-000", "rua": "Rua do Retiro", "numero": "500",
    "complemento": "casa 2", "bairro": "Centro", "cidade": "Jundiaí", "uf": "SP"
  },
  "itens": [
    { "sku": "CIM-50", "nome": "Cimento CP II 50 kg", "quantidade": 4, "preco_centavos": 3990 }
  ],
  "envio": {
    "metodo": "Entrega Persi (Jundiaí)",
    "entrega_propria": true,
    "retirada": false,
    "frete_centavos": 1100,
    "previsao_entrega": "2026-10-08",
    "previsao_calculada_em": "2026-10-08T14:42:10.000Z"
  },
  "pagamento": { "forma": "pix" },
  "link": "https://persimateriais.com.br/minha-conta/pedidos/4512"
}
```

`pendente` (`pago: false`, status "Aguardando pagamento") e `cancelado`
(`pago: false`, status "Cancelado") levam o mesmo bloco `envio`.

## Quando o campo NÃO vai

- chave desligada;
- retirada na loja ou transportadora (Melhor Envio, Correios): `entrega_propria`
  é `false` e não há entrega para encaixar;
- pedido sem os metas (antigo, ou criado com a chave desligada);
- meta com data que não existe no calendário (`2026-02-30`) ou texto qualquer.

Nunca vai `null` nem texto vazio: o campo some.

## Provas

`tests/painelPrevisaoEntrega.test.mjs`: cálculo (Jundiaí antes e depois do corte,
outras regiões), igualdade com o texto do checkout, retirada/transportadora,
metas gravados na criação, aviso dos três eventos, chave desligada = envio
idêntico ao de antes, meta torta ignorada, data congelada em pagamento tardio.
Contra-prova: cada guarda foi retirada e o teste correspondente ficou vermelho.

## Contrato do lado do painel

`envio.previsao_entrega` e `envio.previsao_calculada_em` são aceitos pelo painel
a partir da v79 (persi-atendimento, `docs/contrato-api-sites.md`). Um painel
anterior ignora os dois campos sem erro.
