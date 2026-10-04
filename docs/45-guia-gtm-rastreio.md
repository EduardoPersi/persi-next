# 45 — Guia de configuração do GTM para o rastreio (para quem não é técnico)

Este guia é para o Eduardo configurar, **dentro do Google Tag Manager (GTM)**,
o que o site já manda. O site **não** carrega o GA4 nem o Pixel da Meta por
conta própria: ele só empurra eventos para uma "caixa de correio" chamada
`dataLayer`, e o GTM pega de lá e encaminha ao Google Analytics 4 (GA4) e à
Meta. Assim existe **um** lugar para ligar, desligar e testar cada serviço, e
nada é contado duas vezes.

> Sem o ID do contêiner GTM (`NEXT_PUBLIC_GTM_ID`), o site funciona normalmente,
> só que nada é enviado ao GA4 nem à Meta.

## 1. O que você precisa ter em mãos

| O quê | Onde conseguir | Onde entra |
|---|---|---|
| ID do contêiner GTM (`GTM-XXXXXXX`) | tagmanager.google.com | variável `NEXT_PUBLIC_GTM_ID` do site (já existe) |
| ID de métricas do GA4 (`G-XXXXXXXXXX`) | GA4 › Administrador › Fluxos de dados | dentro do GTM (passo 4) — e, se quiser, na variável `NEXT_PUBLIC_GA4_ID` do site |
| ID do Pixel da Meta (só números) | Gerenciador de Eventos da Meta | dentro do GTM (passo 6) — e, se quiser, em `NEXT_PUBLIC_META_PIXEL_ID` |

`NEXT_PUBLIC_GA4_ID` e `NEXT_PUBLIC_META_PIXEL_ID` são **opcionais**: se
preenchidas, o site oferece os números ao GTM como variáveis (passo 3), para
você não precisar digitá-los dentro do contêiner. Se ficarem em branco, digite
os números direto nas tags — funciona igual. (Mudou uma variável `NEXT_PUBLIC_…`
na Hostinger? Precisa de uma nova build para valer.)

## 2. O que o site manda (nomes EXATOS — copie e cole)

Todo evento chega ao `dataLayer` com a chave `event`. Nenhum carrega nome,
e-mail, telefone ou mensagem do cliente.

### `page_view` — a cada página (já existia)

```json
{ "event": "page_view", "page_path": "/contato", "page_location": "https://persimateriais.com.br/contato", "page_title": "Contato | Persi Materiais" }
```

Dispara na primeira página **e** a cada troca de página dentro do site (o site
não recarrega a página ao navegar, então o GTM sozinho não perceberia).

### `clique_whatsapp` — clique em qualquer botão/link de WhatsApp

```json
{ "event": "clique_whatsapp", "whatsapp_posicao": "rodape", "whatsapp_link_rastreado": true, "whatsapp_link_codigo": "site-padrao", "page_path": "/contato" }
```

| Chave | Valores |
|---|---|
| `whatsapp_posicao` | `botao_flutuante`, `rodape`, `pagina_contato`, `calculadora_frete`, `produto_sem_estoque`, `pagina_404` |
| `whatsapp_link_rastreado` | `true` se passou pelo link do painel; `false` se caiu no `wa.me` original (rastreio ainda sem código) |
| `whatsapp_link_codigo` | o código do link (some quando não há rastreio) |
| `page_path` | página onde o clique aconteceu |

### `gerar_lead` — formulário de contato enviado com sucesso

```json
{ "event": "gerar_lead", "form_name": "contato", "lead_tipo": "formulario", "page_path": "/contato" }
```

### `begin_checkout` — chegou na tela de finalizar compra (uma vez por visita)

```json
{ "ecommerce": null }
{ "event": "begin_checkout", "ecommerce": { "currency": "BRL", "value": 199.9, "items": [ { "item_id": "SKU-123", "item_name": "Placa de gesso", "price": 99.95, "quantity": 2 } ] } }
```

### `purchase` — pedido PAGO, na tela de confirmação (uma vez por pedido)

```json
{ "ecommerce": null }
{ "event": "purchase", "ecommerce": { "transaction_id": "30911", "currency": "BRL", "value": 259.9, "shipping": 20, "items": [ { "item_id": "SKU-123", "item_name": "Placa de gesso", "price": 119.95, "quantity": 2 } ] } }
```

`item_id` é o SKU do produto (ou o número do produto, se não houver SKU) — o
mesmo critério dos eventos `view_item` e `add_to_cart` que o site já manda.
O evento `purchase` só sai se a confirmação mostrar o pedido como pago; abrir a
página de novo **não** repete a venda (o site guarda o número do pedido no
navegador e o GA4 também ignora `transaction_id` repetido). Pix e boleto
pagos depois de a pessoa fechar o site não geram `purchase` (o evento nasce no
navegador, na tela de confirmação).

### Variáveis de configuração (aparecem uma vez, antes de tudo)

```json
{ "ga4_measurement_id": "G-XXXXXXXXXX", "meta_pixel_id": "123456789012345" }
```

Só existem se `NEXT_PUBLIC_GA4_ID` / `NEXT_PUBLIC_META_PIXEL_ID` estiverem
preenchidas.

### Consentimento (já feito pelo site)

Antes de o GTM carregar, o site avisa "tudo negado" (`ad_storage`,
`ad_user_data`, `ad_personalization`, `analytics_storage`) e, quando a pessoa
clica em **Concordo** ou **Recusar** no aviso de cookies, manda a escolha
(`update`) — as quatro chaves mudam juntas para `granted` ou `denied`. Quem já
tinha escolhido em outra visita é reconhecido assim que a página abre.

## 3. Variáveis no GTM (Variáveis › Novo › "Variável da camada de dados")

Crie uma para cada linha (tipo **Variável da camada de dados**, versão 2). O
nome da variável no GTM é só para você; o que importa é a coluna "Nome da
variável da camada de dados" — **idêntico, com letras minúsculas**:

| Nome sugerido no GTM | Nome da variável da camada de dados |
|---|---|
| DLV - ga4_measurement_id | `ga4_measurement_id` |
| DLV - meta_pixel_id | `meta_pixel_id` |
| DLV - whatsapp_posicao | `whatsapp_posicao` |
| DLV - whatsapp_link_rastreado | `whatsapp_link_rastreado` |
| DLV - whatsapp_link_codigo | `whatsapp_link_codigo` |
| DLV - form_name | `form_name` |
| DLV - lead_tipo | `lead_tipo` |
| DLV - page_path | `page_path` |
| DLV - page_location | `page_location` |
| DLV - page_title | `page_title` |
| DLV - ecommerce.value | `ecommerce.value` |
| DLV - ecommerce.currency | `ecommerce.currency` |
| DLV - ecommerce.transaction_id | `ecommerce.transaction_id` |
| DLV - ecommerce.items | `ecommerce.items` |

Mais uma, para o Pixel (tipo **JavaScript personalizado**), que transforma a
lista de itens na lista de números que a Meta pede:

Nome: `JS - ids dos itens`

```js
function () {
  var itens = {{DLV - ecommerce.items}} || [];
  return itens.map(function (i) { return i.item_id; });
}
```

## 4. Acionadores (Acionadores › Novo › "Evento personalizado")

Crie um para cada evento. Em "Nome do evento" escreva exatamente:

| Nome sugerido | Nome do evento |
|---|---|
| CE - page_view | `page_view` |
| CE - clique_whatsapp | `clique_whatsapp` |
| CE - gerar_lead | `gerar_lead` |
| CE - begin_checkout | `begin_checkout` |
| CE - purchase | `purchase` |

(Deixe "Este acionador é disparado em: Todos os eventos personalizados".)
Para a configuração, use o acionador pronto **Inicialização - Todas as páginas**.

## 5. Tags do GA4

### 5.1 Tag do Google (a "configuração")

1. Tags › Nova › **Tag do Google**.
2. ID da tag: `{{DLV - ga4_measurement_id}}` (ou digite o `G-…`).
3. **Configurações da tag › "Enviar um evento de visualização de página quando esta configuração carregar" → DESMARCADO**
   (em "Configurar parâmetros", adicione `send_page_view` = `false` se a opção
   não aparecer). **É importante:** o site já manda o `page_view` sozinho; se
   esta opção ficar ligada, toda página conta duas vezes.
4. Acionador: **Inicialização - Todas as páginas**.
5. Consentimento: deixe como está — a Tag do Google já respeita o Consent Mode
   (`analytics_storage`, `ad_storage`…).

### 5.2 Eventos (Tags › Nova › **Evento do Google Analytics: GA4**)

Em todas: "Tag de configuração" = a tag 5.1 (ou ID `{{DLV - ga4_measurement_id}}`).

| Tag | Nome do evento | Acionador | Parâmetros do evento |
|---|---|---|---|
| GA4 - page_view | `page_view` | CE - page_view | `page_location` = `{{DLV - page_location}}`, `page_title` = `{{DLV - page_title}}` |
| GA4 - clique_whatsapp | `clique_whatsapp` | CE - clique_whatsapp | `whatsapp_posicao` = `{{DLV - whatsapp_posicao}}`, `whatsapp_link_rastreado` = `{{DLV - whatsapp_link_rastreado}}`, `page_path` = `{{DLV - page_path}}` |
| GA4 - gerar_lead | `gerar_lead` | CE - gerar_lead | `form_name` = `{{DLV - form_name}}`, `lead_tipo` = `{{DLV - lead_tipo}}` |
| GA4 - begin_checkout | `begin_checkout` | CE - begin_checkout | marque **Enviar dados de comércio eletrônico** › Origem: **Camada de dados** |
| GA4 - purchase | `purchase` | CE - purchase | marque **Enviar dados de comércio eletrônico** › Origem: **Camada de dados** |

Depois de publicar, no GA4 (Administrador › Eventos) marque `gerar_lead`,
`clique_whatsapp` e `purchase` como **evento principal** (antes "conversão").
Para os parâmetros `whatsapp_posicao`, `form_name` etc. aparecerem nos
relatórios, cadastre-os em Administrador › Definições personalizadas ›
Dimensões personalizadas (escopo "Evento").

## 6. Pixel da Meta

Equivalência entre os eventos do site e os da Meta:

| Evento do site | Evento da Meta | Dados que acompanham |
|---|---|---|
| `clique_whatsapp` | `Contact` | — |
| `gerar_lead` | `Lead` | — |
| `begin_checkout` | `InitiateCheckout` | `value`, `currency`, `content_ids`, `content_type` |
| `purchase` | `Purchase` | `value`, `currency`, `content_ids`, `content_type`, id do pedido |

Use tags do tipo **HTML personalizado** (ou o modelo "Pixel do Facebook" da
galeria da comunidade, se preferir — os nomes de evento são os mesmos).

**6.1 Pixel — código base.** Tag HTML personalizado, acionador **Inicialização -
Todas as páginas**. **Configurações avançadas › Configurações de consentimento
› "Exigir consentimento adicional para a tag disparar" → `ad_storage`.** Assim
o Pixel só liga para quem clicou em **Concordo**.

```html
<script>
!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '{{DLV - meta_pixel_id}}');
</script>
```

(Sem `fbq('track','PageView')` aqui: o PageView entra na tag do `page_view`
abaixo, para contar uma vez por troca de página.)

**6.2 Eventos** — tags HTML personalizado, todas com o mesmo consentimento
adicional (`ad_storage`). Dê ao código base (6.1) "Prioridade de disparo" **10**
(Configurações avançadas › Prioridade de disparo; o maior número dispara
primeiro) e deixe as de evento em 0, para o `init` rodar antes. Cada uma com o
acionador indicado:

| Tag | Acionador | Código |
|---|---|---|
| Meta - PageView | CE - page_view | `<script>fbq('track','PageView');</script>` |
| Meta - Contact | CE - clique_whatsapp | `<script>fbq('track','Contact');</script>` |
| Meta - Lead | CE - gerar_lead | `<script>fbq('track','Lead');</script>` |
| Meta - InitiateCheckout | CE - begin_checkout | veja abaixo |
| Meta - Purchase | CE - purchase | veja abaixo |

```html
<!-- Meta - InitiateCheckout -->
<script>
fbq('track', 'InitiateCheckout', {
  value: {{DLV - ecommerce.value}},
  currency: 'BRL',
  content_ids: {{JS - ids dos itens}},
  content_type: 'product'
});
</script>
```

```html
<!-- Meta - Purchase -->
<script>
fbq('track', 'Purchase', {
  value: {{DLV - ecommerce.value}},
  currency: 'BRL',
  content_ids: {{JS - ids dos itens}},
  content_type: 'product'
}, { eventID: 'purchase_{{DLV - ecommerce.transaction_id}}' });
</script>
```

> O `eventID` com o número do pedido permite à Meta descartar repetições do
> mesmo pedido.

## 7. Consentimento (Consent Mode v2) no GTM

O site já faz a parte dele (seção 2). No GTM falta só conferir:

1. Administrador › **Configurações do contêiner** › marque **Ativar visão geral
   do consentimento**.
2. Em **Tags** › ícone de escudo (Consentimento): a *Tag do Google* e as tags
   do GA4 mostram "Consentimento integrado" — não precisa mexer.
3. As tags da Meta (HTML personalizado) mostram "Consentimento não configurado":
   abra cada uma › Configurações avançadas › Configurações de consentimento ›
   **Exigir consentimento adicional** › `ad_storage` (como em 6.1).
4. **Não** crie outra tag de "Padrão de consentimento" no GTM: o padrão já é
   definido pelo site, antes de o GTM carregar. Duas configurações brigam.

Efeito para quem **recusa**: o GA4 pode receber pings sem cookie (modelagem do
Google) e o Pixel da Meta não dispara. Quem **aceita**: tudo liga.

## 8. Como testar (antes de publicar o contêiner)

1. No GTM, clique em **Visualizar** e informe `https://persimateriais.com.br`.
2. Abra a página com campanha, por exemplo
   `https://persimateriais.com.br/contato?utm_source=google&utm_medium=cpc&gclid=teste`.
3. No painel do Tag Assistant confira, nesta ordem: **Consent** (tudo negado)
   → **Container Loaded** → **page_view** (uma única vez). Clique em
   **Concordo** e veja o evento de consentimento mudar para concedido.
4. Clique num botão de WhatsApp: deve aparecer o evento **clique_whatsapp**
   com `whatsapp_posicao` preenchido, e as tags GA4 - clique_whatsapp e
   Meta - Contact marcadas como "disparada".
5. Envie o formulário de /contato: **gerar_lead**. (Se o e-mail do formulário
   estiver desligado no WordPress, a tela mostra erro e o evento não sai — é o
   comportamento certo: só conta lead enviado.)
6. Faça uma compra de teste até a tela de confirmação paga: **begin_checkout**
   na tela de finalizar e **purchase** na confirmação, com `transaction_id`,
   `value` e `items`.
7. No GA4 › Administrar › **DebugView**, os mesmos eventos aparecem em tempo
   real (use a extensão "Google Analytics Debugger" ou o próprio Visualizar do
   GTM). Na Meta, use a extensão **Meta Pixel Helper**.
8. Confira que `page_view` não aparece em dobro (se aparecer, a opção do passo
   5.1 item 3 ficou ligada).
9. Só então clique em **Enviar** (publicar) no GTM.

Dica para ver tudo sem ferramenta nenhuma: abra o site, aperte F12 › aba
**Console** e digite `dataLayer`. Cada evento deste guia aparece na lista.

## 9. Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Nada aparece no GTM | `NEXT_PUBLIC_GTM_ID` vazio ou build antiga |
| `page_view` em dobro | passo 5.1 item 3 (enviar page_view na configuração) ficou marcado |
| Pixel não dispara nunca | visitante recusou os cookies, ou a tag não tem o acionador de inicialização |
| `purchase` sem itens | pedido antigo sem SKU/produto, ou a consulta de detalhes falhou: o evento sai com `value` e `transaction_id` mesmo assim |
| `clique_whatsapp` com `whatsapp_link_rastreado: false` | `NEXT_PUBLIC_WHATSAPP_LINK_CODIGO` ainda vazio — o botão funciona (cai no `wa.me`), só não é rastreado pelo painel |
