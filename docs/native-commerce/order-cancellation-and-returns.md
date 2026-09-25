# Cancelamento e devolução de pedidos — Native Commerce

Status: **decisão do dono registrada, nada implementado**. Este documento
substitui, para tudo relacionado a cancelamento/estorno, o runbook
provisório da Seção 6.3 de
[`olist-integration-design.md`](olist-integration-design.md#63-cancelamento-e-estorno-pós-pagamento-requisito-do-canário)
— aquela seção tratava só o caso "divergência de estoque pós-pagamento";
este documento é a política completa, cobrindo também cancelamento
solicitado pelo cliente e devolução por arrependimento.

## 1. Estorno financeiro — sempre manual nesta fase

**Decisão**: nesta fase, todo estorno é feito **manualmente**, pelo painel
do provedor (Banco Inter, Mercado Pago ou PagBank), **nunca** por uma
chamada automática à API de estorno de nenhum dos três. SLA: **até 24
horas úteis** após o cancelamento ser confirmado. Estorno automático via
API é **fase futura**, não construído nem desenhado em detalhe aqui.

Consequência direta para o design já existente: o gap "nenhum adapter de
pagamento chama a API de estorno do provedor", registrado em
`olist-integration-design.md` §6.3 como bloqueador do canário, **deixa de
ser bloqueador** — a decisão do dono resolve esse ponto operacionalmente
(um humano faz o estorno), não tecnicamente. Ver Seção 7 para a atualização
formal daquele documento.

**"Registro no sistema"**: mesmo o estorno sendo manual, ele deve ficar
registrado nativamente para consulta/auditoria — reaproveita o mecanismo já
existente e já pronto para isso, sem nenhuma migration nova:

- `createNativeRefund` (`lib/db/nativePayment.ts:98`) — cria a linha de
  reembolso na ledger nativa (`refund_status = 'requested'`), com o motivo
  (`stock_unavailable_after_sync`, `customer_requested_before_invoicing`,
  conforme o caso).
- Depois que o estorno é de fato feito no painel do provedor, a equipe (ou
  uma tela administrativa futura) atualiza esse mesmo registro para
  `refund_status = 'processing'` e depois `'completed'` via
  `transitionNativeRefund` (`lib/db/nativePayment.ts:136`) — sem isso, o
  sistema nativo nunca saberia que o dinheiro já voltou para o cliente.
- **Não construído ainda**: uma tela/rota que permita à equipe marcar esse
  reembolso como concluído sem editar o banco diretamente — hoje esse
  registro só é gravável via chamada direta às funções acima (script/
  console administrativo). Ver Seção 6.

## 2. Cancelamento pelo cliente — antes do faturamento

**Decisão**: o cliente pode cancelar o pedido **somente até ele ser
FATURADO** (o status de faturamento vem do Olist — Seção 4).

### 2.1 Fluxo

1. Cliente aciona "cancelar pedido" (canal e mecanismo variam por fase —
   Seção 6).
2. Pedido nativo entra em um estado "cancelamento solicitado" — **em
   aberto**: `orders.status` (`pending | confirmed | cancelled |
   completed`) não tem hoje um valor para isso; ver Seção 5.1 para a
   decisão de modelagem pendente.
3. O pedido de cancelamento é comunicado ao Olist (canal também varia por
   fase — Seção 6: manual via painel do Olist no canário, automatizado
   depois).
4. A equipe cancela o pedido no Olist e realiza o estorno manualmente
   (Seção 1).
5. O sync Olist→site (`olist-integration-design.md` §5) reflete o
   cancelamento de volta, marcando o pedido nativo como `cancelled`.
6. Cliente é notificado com o texto abaixo.

### 2.2 Texto ao cliente (aprovado, usar literalmente)

> Pedido cancelado. Vamos devolver o valor em até 24 horas úteis.
> Pix: volta para a conta de origem. Cartão: o estorno é solicitado nesse
> prazo e o crédito aparece na fatura conforme o prazo da operadora.

Este texto não depende de qual meio de pagamento foi usado — cobre Pix e
cartão genericamente, então pode ser reutilizado sem lógica condicional de
copy por provedor.

## 3. Após o faturamento — devolução por arrependimento (não é cancelamento)

**Decisão**: depois de faturado, não existe mais "cancelamento" — o
caminho passa a ser **devolução por arrependimento**, em até **7 dias**
após o **recebimento** do produto pelo cliente (não da compra nem do
faturamento — a contagem começa quando o produto chega).

- O estorno só ocorre **depois** que o produto for devolvido, recebido de
  volta pela loja e **conferido** (confirmar que o item devolvido é o
  correto e está em condição aceitável) — não no momento em que o cliente
  solicita a devolução.
- **Pendência registrada, não resolvida aqui**: validar esta política com
  assessoria jurídica/contábil, especificamente à luz do **Código de
  Defesa do Consumidor, art. 49** (direito de arrependimento em compras
  fora do estabelecimento comercial, prazo de 7 dias corridos a contar do
  recebimento). Este documento assume que a política descrita já está
  alinhada com o art. 49, mas isso precisa de confirmação formal antes de
  publicar qualquer texto jurídico/comercial definitivo ao cliente.
- Fluxo completo (logística reversa, quem paga o frete de volta, condições
  de aceite da devolução) **não está desenhado neste documento** — Fase
  "devolução pelo site" (Seção 6) é quando isso precisa ser detalhado.

## 4. Onde o cliente cancela ou solicita devolução

Dois caminhos, dependendo de o cliente estar logado ou ter comprado como
convidado:

### 4.1 Cliente logado

"Minha conta → Meus pedidos" — área já existente
(`app/(institutional)/minha-conta/pedidos` — confirmar path exato ao
implementar; hoje é só leitura de histórico via Woo, precisa do
equivalente nativo).

### 4.2 Convidado — página "Acompanhar pedido"

Acessada por um **link seguro enviado no e-mail de confirmação do
pedido**, sem exigir login. Requisitos de segurança do token, reaproveitando
exatamente o padrão já usado e já testado para o cookie de carrinho de
convidado (`lib/db/nativeCart.ts`: `generateGuestCartToken`/
`hashGuestCartToken`/`verifyGuestCartToken`, Gate 3):

- Token de **alta entropia**, gerado no servidor (`randomBytes`, mesmo
  tamanho já usado: 32 bytes).
- Banco grava **somente o hash** do token (SHA-256), nunca o valor bruto —
  o valor bruto existe só no link enviado por e-mail.
- Comparação em tempo constante (`timingSafeEqual`) ao validar o token
  recebido na URL.
- **Expiração**: o link não pode ser válido para sempre — prazo a definir
  (candidato natural: alinhado à janela de cancelamento/devolução do
  pedido — Seções 2 e 3 — mas isto é uma sugestão, não uma decisão do
  dono; registrar como pergunta aberta na Seção 7).
- **Sem PII além do necessário**: a página, ao ser aberta com um token
  válido, deve mostrar o suficiente para o cliente se orientar (itens,
  status, opção de cancelar/solicitar devolução) sem precisar expor dados
  como CPF completo, endereço completo ou telefone na tela — os mesmos
  princípios de mascaramento que já existem em outros pontos do sistema
  (`orders.taxIdMasked`, por exemplo, já existe para este propósito: exibir
  uma versão mascarada do documento, nunca o valor puro, sem precisar
  descriptografar `checkoutPii`/`nativeCheckoutPii` para uma tela pública).
- **Não construído ainda**: a rota/página em si, a emissão do link no
  e-mail de confirmação (que por sua vez depende do e-mail transacional de
  pedido, hoje design-only em
  `docs/database/83-transactional-email-v1-design.md`), e o schema para
  guardar o hash do token (provavelmente uma nova coluna/tabela associada a
  `orders`, a especificar quando esta fase for desenhada em detalhe — não
  inventado aqui).

## 5. Sincronização com o Olist

**Decisão**: um cancelamento **iniciado no próprio Olist** (por qualquer
motivo — ruptura de estoque física, decisão comercial, etc.) deve refletir
no site através do mesmo sync Olist→site de estoque/pedido já desenhado
como Fase 1 do Olist (`olist-integration-design.md` §5) — o pedido nativo
correspondente é marcado como cancelado quando esse sinal chega.

### 5.1 Modelagem pendente (não decidida aqui)

`orders.status` hoje é um enum de 4 valores
(`pending | confirmed | cancelled | completed`,
`lib/db/schema/orders.ts:6`) — não existe um estado "cancelamento
solicitado, aguardando confirmação do Olist" distinto de "cancelado". As
opções (nenhuma escolhida ainda, para não inventar decisão de schema que é
migration):

- (a) reaproveitar um campo/flag separado (ex.: um `cancellation_requested_at`
  nullable) enquanto `status` continua `confirmed`, só virando `cancelled`
  quando o Olist confirmar — evita alterar o enum.
- (b) adicionar um novo valor ao enum (`cancellation_requested`) — mudança
  de schema maior, mexe na máquina de estados já usada por
  `apply_verified_payment_transition` e pela verificação de estados
  proibidos documentada em `docs/database/78-*` (não citado por número
  exato aqui — conferir antes de decidir).

Em ambos os casos, uma migration é necessária; nenhuma foi feita ou
proposta em detalhe aqui — só relevante a partir da Fase 1+ (Seção 6), não
bloqueia o canário.

## 6. Fases

**Fase 1 (canário)** — o mínimo necessário para os primeiros pedidos reais,
**sem nenhuma UI de autoatendimento de cancelamento**:

- Canal do cliente: **atendimento via WhatsApp** (já é um canal existente e
  aprovado no projeto — `AGENTS.md` §30.1) — não uma rota/botão no site.
- Canal para o Olist: a equipe cancela **manualmente no painel do Olist** —
  nenhum evento `order.cancel` automatizado é construído nesta fase (isto
  reverte o que `olist-integration-design.md` §6.3/§7 havia marcado como
  bloqueador do canário — ver Seção 7 abaixo).
- Estorno: manual, painel do provedor, registrado na ledger nativa
  (Seção 1).
- Nenhuma modelagem de schema nova é necessária para o canário em si,
  **desde que** o volume inicial seja baixo o bastante para a equipe
  acompanhar cancelamentos manualmente sem uma fila/estado dedicado no
  banco — isto é uma suposição operacional, não uma garantia técnica;
  reavaliar se o volume crescer antes da Fase 1+.

**Fase 1+ (logo após o canário, antes de ampliar tráfego)**:

- Botão de cancelamento no painel do cliente (Seção 4.1) e página
  "Acompanhar pedido" para convidados (Seção 4.2).
- Envio automatizado do pedido de cancelamento ao Olist (fecha o gap
  `order.cancel` do outbox, `olist-integration-design.md` §7).
- Notificação automática ao cliente com o texto da Seção 2.2 (depende do
  e-mail transacional, `docs/database/83-*`).

**Fase seguinte — devolução pelo site**:

- Fluxo completo de devolução por arrependimento (Seção 3) desenhado em
  detalhe: logística reversa, custeio do frete de volta, critérios de
  conferência do produto devolvido, e o estorno pós-conferência.
- Validação jurídica/contábil formal da política (Seção 3).

**Fase futura, não desenhada** — estorno automático via API de cada
provedor (Seção 1) — só depois que o volume/operação justificar o
investimento; nada neste documento assume que isso vai acontecer em prazo
definido.

## 7. Atualização necessária em `olist-integration-design.md`

A Seção 6.3 daquele documento (escrita antes desta decisão) tratava o
estorno por divergência de estoque como algo que exigia construir a
chamada de API de estorno nos três adapters de pagamento, classificando
isso como bloqueador do canário. Esta decisão do dono resolve isso
operacionalmente (estorno manual, Seção 1) — a Seção 6.3 daquele documento
foi atualizada para apontar para este documento em vez de manter sua
própria versão, agora desatualizada, do runbook.

## 8. Perguntas em aberto (para o dono, não bloqueiam o canário)

1. Prazo de expiração do link de "Acompanhar pedido" (Seção 4.2) — uma
   sugestão foi proposta, não uma decisão.
2. Modelagem exata de "cancelamento solicitado, aguardando confirmação do
   Olist" no schema (Seção 5.1) — duas opções levantadas, nenhuma
   escolhida; só relevante a partir da Fase 1+.
3. Quem paga o frete de devolução por arrependimento (Seção 3) — não
   perguntado ainda, relevante só na fase de devolução pelo site.
4. Confirmação formal da assessoria jurídica/contábil sobre a política de
   devolução (Seção 3) antes de publicar qualquer texto definitivo ao
   cliente.