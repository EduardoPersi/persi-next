# 42 — Mensagens automáticas pelo WhatsApp (painel de atendimento)

## Para que serve

O site não fala WhatsApp. Quem tem o número da loja conectado é o painel de
atendimento (`persi-atendimento`), e é ele quem envia. O site apenas **pede**
o envio, por um webhook autenticado.

Dois tipos de aviso estão previstos:

| Tipo | Quando sai | Estado |
| --- | --- | --- |
| `pedido` | pagamento aprovado (Pix, boleto, cartão) | **ligado** |
| `codigo_acesso` | recuperação de senha | **pendente** — ver "Bloqueio conhecido" |

## Como chamar

Tudo passa por `lib/painel/whatsapp.ts`. Nenhuma outra parte do site deve
montar esse request na mão.

```ts
import { avisarPedido } from "@/lib/painel/whatsapp.ts";

void avisarPedido({
  telefone: order.billingPhone,
  pedido: String(order.id),
  status: "Pagamento aprovado",
  link: `${SITE_URL}/minha-conta/pedidos/${order.id}`,
}).catch(() => {});
```

### Regra de ouro: falhar aqui não derruba nada

Nenhuma função de `lib/painel/whatsapp.ts` lança. Todas devolvem
`{ enviado: true, conversa }` ou
`{ enviado: false, motivo, status?, podeTentarDeNovo }`.

Se o painel estiver fora do ar, com a chave errada ou sem configuração, o
pedido continua pago e o cliente não vê erro nenhum. O aviso é disparado
**depois** de o pedido já estar marcado como pago, e solto (`void ... .catch`).

`podeTentarDeNovo` separa o que adianta repetir (painel fora do ar, tempo
esgotado, 5xx) do que não adianta (chave errada, telefone inválido, limite por
telefone atingido, 4xx). Hoje não há fila de reenvio; o campo existe para
quando houver.

## Onde está ligado hoje

`services/payments/reconcile.ts` — no ponto único em que um pedido passa a
pago (`category === "paid"`), que cobre Inter (Pix e boleto), PagBank e
Mercado Pago de uma vez só. A dependência entra por
`ReconcilePaymentReferenceDeps.avisarPedido`, então os testes podem trocá-la
sem tocar na rede.

Sem `billingPhone` no pedido, nada é enviado — e isso não é erro: nem todo
checkout pede telefone. O campo vem de `billing.phone` do WooCommerce
(`services/woocommerce/orders.ts`).

## Configuração

```
PAINEL_URL=https://painel.exemplo.com.br
SITE_WEBHOOK_KEY=<mesma chave do .env do painel>
```

Somente servidor. Nunca usar prefixo `NEXT_PUBLIC_`. Com qualquer uma das duas
vazia, `avisarPeloWhatsapp` nem chega a fazer a requisição: devolve
`enviado: false` com `podeTentarDeNovo: false` e o site segue normal. É esse o
estado de um ambiente que ainda não foi ligado ao painel.

A chave é comparada no painel com `crypto.timingSafeEqual` sobre o hash dos
dois lados.

## Contrato do endpoint

`POST {PAINEL_URL}/api/webhooks/site/notificar`
com `X-Site-Webhook-Key: <SITE_WEBHOOK_KEY>`.

```json
{ "tipo": "pedido", "telefone": "...", "pedido": "1234",
  "status": "Pagamento aprovado", "cliente": "...",
  "total_centavos": 12345, "observacao": "...", "link": "https://..." }
```

```json
{ "tipo": "codigo_acesso", "telefone": "...", "codigo": "K7M2PQ",
  "validade_minutos": 10 }
```

O campo `link` só é aceito se apontar para `persimateriais.com.br` (ou um
subdomínio); qualquer outro é descartado pelo painel.

O painel aplica limite por telefone: código de acesso, 3 por 15 minutos com no
mínimo 1 minuto entre eles; pedido, 10 por hora. Estourar o limite devolve 4xx
— `podeTentarDeNovo: false`, não adianta insistir.

Cada chamada fica no diário do painel (`GET /api/webhooks/site/diagnostico`),
com o telefone mascarado nos quatro últimos dígitos.

## Código de acesso: quem gera é o site

O painel **só entrega**. Não gera, não guarda e não valida código nenhum —
para ele é um texto opaco que vai dentro da mensagem. O histórico do painel
guarda apenas *"Código de acesso enviado pelo site (vale 10 min). O código não
fica guardado aqui."*

Gerar, guardar e conferir é responsabilidade do site.
`gerarCodigoDeAcesso()` devolve 6 caracteres sorteados com
`crypto.getRandomValues` (nunca `Math.random()`, que é previsível), sem I, O,
0 e 1 — lidos às pressas no WhatsApp, viram um ao outro.

## Bloqueio conhecido: recuperação de senha

`gerarCodigoDeAcesso` **não tem ponto de chamada ainda**, e isso é proposital.

`app/api/account/forgot-password/route.ts` chama
`forgotAccountPassword(payload.email)`, que delega a
`requestAccountEndpoint({ route: "/forgot-password" })` — o plugin
`persi-headless` no WordPress. Quem emite e valida a chave de redefinição é o
WordPress, por e-mail; o site nunca vê essa chave e não tem onde guardar uma
sua (`resetAccountPassword` exige `{ login, key }`, e `key` é a do WordPress).

Fazer o site emitir um código próprio para WhatsApp significaria criar um
**segundo caminho de redefinição de senha**, com armazenamento, expiração e
verificação próprios, ao lado do que já existe no WordPress. Isso é mudança de
autenticação, não fiação de webhook — cai na regra do `AGENTS.md` §26.2
(propor plano antes de mexer) e §35 (segurança em primeiro lugar). Não foi
feito.

Dois caminhos possíveis, quando o assunto for decidido:

1. **WordPress manda o código.** O plugin `persi-headless` passa a gerar e
   validar o código e chama o webhook do painel direto, sem passar pelo
   Next.js. É o menor desvio do que já funciona — a fonte de verdade da senha
   continua sendo uma só.
2. **O site passa a ter seu próprio fluxo.** Exige tabela de códigos com
   expiração, limite de tentativas, vínculo telefone↔conta verificado e
   invalidação do código após uso. Mais trabalho e mais superfície de ataque.

Até a decisão, a recuperação de senha continua pelo e-mail, inalterada.

## Testes

```bash
npm run test:painel
```

`tests/painel/whatsapp.test.mjs` cobre: URL, cabeçalho e corpo corretos;
painel fora do ar → `podeTentarDeNovo: true`; 401 → `false`; 503 → `true`; sem
configuração não há requisição nenhuma; e 400 códigos gerados, todos no
formato esperado e com variedade suficiente.
