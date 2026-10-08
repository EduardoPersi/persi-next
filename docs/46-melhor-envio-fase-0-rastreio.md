# Melhor Envio — Fase 0: aviso de "enviado" com rastreio

Escrito em 07/10/2026. Faz parte do plano de tirar a dependência do plugin
"WC Melhor Envio" do WordPress (ver "Próximas fases" no fim).

## O que esta fase faz

O plugin do WordPress continua pedindo a etiqueta e consultando o Melhor Envio.
Esta fase só **aproveita o que ele já grava no pedido** para avisar o cliente:

1. o plugin consulta o rastreio (padrão: 1 vez por dia; dá para deixar de hora
   em hora) e grava o código no pedido, no meta `_melhor_envio_tracking_codes`;
2. ao salvar o pedido, o WooCommerce dispara o webhook **"Pedido atualizado"**
   (o mesmo que já avisa cancelado, entregue e reembolso);
3. o site lê o código no payload (`lib/rastreio/melhorEnvio.ts`), decide se já
   dá para avisar (`lib/painel/rastreio.ts`) e pede ao painel de atendimento o
   WhatsApp **"enviado"**, com a transportadora e o código;
4. em **Minha conta › Pedido** aparece "Acompanhe seu envio", com o código e o
   link do Melhor Rastreio.

**Não mexe em frete, total nem cobrança.**

## Quando o aviso "enviado" sai

Só se **todas** as condições valem:

- o pedido tem código de rastreio;
- o status do pedido **não** está na lista "sem aviso" (padrão:
  `pending, failed, cancelled, refunded, completed, trash, auto-draft`) — um
  "enviado" depois de "entregue" não faz sentido;
- o frete **não** é da equipe da loja nem retirada (mesmas listas
  `PAINEL_ENVIO_LOJA` e `PAINEL_ENVIO_RETIRADA` do resto do painel).

O painel responde 409 a um segundo "enviado" do mesmo pedido, e isso é o
normal (o webhook repete a cada alteração do pedido).

## O que ligar e conferir

No site (hPanel › Node.js › variáveis de ambiente):

| Variável | Para quê |
|---|---|
| `PAINEL_AVISAR_ANDAMENTO=1` | liga o andamento pelo WhatsApp (já existia; "enviado" usa a mesma chave) |
| `PAINEL_ENVIO_STATUS_SEM_AVISO` | opcional: troca a lista de status que **não** disparam "enviado" |

No WordPress (WooCommerce › Configurações › Integração › Melhor Envio), conferir
as opções do plugin de rastreio:

- **status a consultar**: os status em que o pedido fica depois da etiqueta
  gerada (senão o plugin nunca consulta aquele pedido);
- **intervalo de consulta**: `de hora em hora` dá avisos mais rápidos que o
  padrão diário;
- **status depois de postado**: opcional; se escolher um status próprio
  ("Enviado"), confira que ele não está na lista "sem aviso";
- **status depois de entregue**: para o cliente receber o **"entregue"**, o
  pedido precisa ir para **Concluído** (no WooCommerce da Persi, Concluído =
  entregue). Sem isso o aviso de entregue não sai.

O webhook "Pedido atualizado" já precisa estar cadastrado (ver
`docs/42-painel-whatsapp.md`, com o segredo `PAINEL_WOO_PEDIDO_WEBHOOK_SECRET`).

## Limites desta fase

- **Atraso:** o aviso sai quando o plugin consulta o Melhor Envio, não na hora
  da postagem. Além disso, o código de rastreio pode demorar até 1 dia útil
  depois da postagem (varia por transportadora).
- **Um código por aviso:** com mais de um volume, o WhatsApp leva o primeiro
  código; Minha conta mostra todos (até 5).
- **Não há "a caminho"/"saiu para entrega":** a documentação do Melhor Envio
  não lista esse evento. Só a entrega própria terá "a caminho" (módulo de
  Entregas, ainda não feito).
- **O rastreio não é corrigido:** o painel avisa "enviado" uma vez por pedido.
  Se o código mudar depois, o WhatsApp não é reenviado (Minha conta mostra o
  atual).

## Regras configuráveis (para o futuro painel de administração)

Hoje: variável de ambiente, com padrão no código. Candidatas a virar tela:

- lista de status que não disparam "enviado";
- quais formas de frete são "da loja", "retirada" ou "transportadora";
- o texto da mensagem de "enviado" (hoje fixo no painel de atendimento,
  `backend/src/andamentoSite.js`).

## Próximas fases

- **Fase 1:** cotação direta no checkout nativo, em sandbox (OAuth, mapeamento
  produto → variante, regras de embalagem). **Muda frete e total: exige
  aprovação específica.**
- **Fase 2:** criar o pré-pedido (carrinho do Melhor Envio) após o pagamento
  aprovado, comprar/gerar/imprimir etiqueta (manual no começo, pois gasta
  saldo) e receber os webhooks `order.posted`, `order.delivered`,
  `order.cancelled`, `order.undelivered`, `order.paused` e `order.suspended`
  (assinatura `X-ME-Signature`, HMAC-SHA256 do corpo com o segredo do
  aplicativo; só vale para etiquetas geradas pelo **mesmo aplicativo** cadastrado
  na Área Dev do Melhor Envio).
- **Fase 3:** ligar em produção quando houver banco, e tirar o plugin.
