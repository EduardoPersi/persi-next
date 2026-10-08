# Feriados e prazo de entrega

Escrito em 07/10/2026. Código em `lib/shipping/calendar/`.

## Como o prazo é calculado

| Regra | Padrão da Persi |
|---|---|
| Corte para sair no mesmo dia | **13h** nos dias de semana, **10h** aos sábados (um pedido às 13h00 em ponto já é "depois") |
| Dias em que a loja despacha | segunda a **sábado**, menos feriado (nacional, de SP e de Jundiaí) |
| Trânsito de transportadora (Melhor Envio) | dias **úteis** segunda a sexta, menos feriado nacional, de SP e do município de **destino** |
| Entrega própria | conta **dias de operação** (segunda a sábado) conforme a regra da zona (abaixo) |

### Zonas da entrega própria (decisão de 07/10/2026)

| Destino | Regra | Exemplo (corte de 13h) |
|---|---|---|
| **Jundiaí** (CEP 13200-000 a 13219-999, ou a cidade) | sai no mesmo dia antes do corte; depois, no dia seguinte | quarta 10h → "Chega hoje"; quarta 14h → "Chega amanhã, dia 8" |
| **Demais regiões** atendidas | 1 dia antes do corte, 2 depois | quarta 10h → "Chega amanhã"; quarta 14h → "Chega sexta, dia 9" |

A entrega própria é o frete `flat_rate` / `free_shipping` do WooCommerce (hoje o
"Frete Expresso" de R$ 10 em Jundiaí e R$ 20 em Itupeva); a retirada
(`local_pickup`) não tem previsão. Transportadoras usam o prazo que o provedor
informa: `melhorenvio_delivery_time` (Melhor Envio) ou `delivery_time`/texto
"2 dias úteis" (Olist Envios). Os dias, as zonas e os métodos ficam em
`lib/shipping/calendar/arrival.ts` (`DEFAULT_OWN_DELIVERY_ZONES`).

**Onde aparece:** na calculadora de frete (carrinho e produto) e no checkout,
como uma linha verde em cada opção. É calculado no navegador, depois que a
tela carrega, com a hora de São Paulo.

**Limite conhecido:** a calculadora só sabe o CEP, não a cidade. A zona de
Jundiaí vale por faixa de CEP; já o feriado **municipal do destino** só entra no
cálculo quando a cidade é conhecida (no checkout, sim; na calculadora, só os
feriados nacionais e de SP).

O feriado municipal de **Jundiaí** só decide em que dia o pedido pode **sair**.
Depois que o pacote sai, o que atrasa o trânsito é o feriado do destino.

Textos (`formatArrival`): "Chega hoje", "Chega amanhã, dia 7", "Chega quinta,
dia 9" (mesma semana), "Chega até a próxima terça, dia 13" (semana seguinte) e
"Chega até sexta, dia 23 de outubro" (mais longe). A semana vai de segunda a
domingo.

Tudo é configurável: o horário de corte (`CutoffRule`), os dias de operação, a
loja e a lista de feriados. Hoje os padrões estão no código
(`deliveryDate.ts`, `holidaysDefault.ts`); a ideia é o painel de administração
passar a fornecê-los.

## O CSV de feriados (para o painel importar)

Primeira linha = cabeçalho. Separador `;` ou `,`. UTF-8, com ou sem BOM.

```
data;nome;escopo;uf;cidade;facultativo
25/12;Natal;nacional;;;
09/07;Revolução Constitucionalista;estadual;SP;;
15/08;Nossa Senhora do Desterro;municipal;SP;Jundiaí;
Corpus Christi;Corpus Christi;municipal;SP;Jundiaí;
04/06/2026;Dia especial só deste ano;municipal;SP;Itu;
```

- **data**: `DD/MM/AAAA` ou `AAAA-MM-DD` (vale só naquele ano), `DD/MM` (todo
  ano) ou `Corpus Christi`, `Sexta-feira Santa`, `Carnaval segunda`, `Carnaval
  terça` (calculado todo ano pela Páscoa).
- **escopo**: `nacional`, `estadual` ou `municipal`. Se vazio: com cidade =
  municipal, só com UF = estadual, senão nacional.
- **uf**: obrigatória em estadual. **cidade**: obrigatória em municipal (a
  comparação ignora acento e maiúscula).
- **facultativo**: `sim` = ponto facultativo, que **não** conta como feriado.

`parseHolidayCsv` devolve os feriados válidos **e** a lista de erros com o
número da linha, para a tela de importação mostrar o que corrigir.

Por padrão entram sozinhos: a Sexta-feira Santa (feriado nacional); Carnaval e
Corpus Christi nacionais são ponto facultativo e **só contam onde a cidade os
declara** na lista.

## De onde vieram os feriados municipais

Fonte principal: calendário do Tribunal de Justiça de SP para **2026**
(Provimento CSM nº 2.813/2025, feriados municipais por comarca), conferido com
decretos municipais e o anexo do TRT-15.

| Cidade | Fixos | Corpus Christi | Observação |
|---|---|---|---|
| Jundiaí | 15/08 (Padroeira) | sim | decreto municipal anual |
| Itupeva | 20/01 | sim | nome a confirmar |
| Jarinu | 17/04, 16/07 | sim | decreto nº 3.539/2025 |
| Cabreúva | 24/03, 15/09 | **não** | nomes a confirmar |
| Itatiba | 08/09 | sim | Lei 827/1967 |
| Louveira | 20/01, 21/03 | sim | nome do 20/01 a confirmar |
| Várzea Paulista | 21/03, 15/09 | **não** | |
| Campo Limpo Paulista | 21/03, 07/10 | sim | Lei 583/77 (07/10) |
| Cajamar | 20/01, 18/02 | sim | decreto nº 7.650/2025 |
| Vinhedo | 02/04, 26/07 | sim | nome do 26/07 a confirmar |
| Itu | 02/02 | sim | Lei 998/1967 |
| Valinhos | 20/01, 28/05 | sim | nomes a confirmar |
| Franco da Rocha | 30/11 | sim | |
| Perus (distrito de São Paulo) | 25/01 | sim | segue a capital; não há feriado próprio do distrito |

Nacionais fixos: 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, **20/11**
(nacional desde 2024, Lei 14.759/2023), 25/12. Estadual de SP: 09/07.

## O que ficou de fora de propósito

Aparecem só em sites de calendário e **contradizem** a fonte oficial; não
entraram:

- Jundiaí 14/12; Itupeva 21/03; Campo Limpo 28/02; Valinhos 30/12;
  Franco da Rocha 08/12 (esse último não está no calendário do TJSP).
- Pontos facultativos de decreto municipal (Carnaval, dias "ponte" como 16/08 ou
  30/12 em Jundiaí): valem para o serviço público da prefeitura, não para o
  comércio.

A **BrasilAPI** (`/feriados/v1/{ano}`) cobre só os nacionais, e marca Carnaval,
Corpus Christi e o domingo de Páscoa como "nacional", o que **não** é feriado por
lei. Por isso ela não é usada cegamente; os nacionais estão na lista padrão e os
móveis são calculados.

## Pendências

- **2027:** o calendário oficial do TJSP só sai no fim de 2026. As datas fixas
  costumam se repetir, mas revise a lista então.
- Nomes de feriado marcados "a confirmar" e números de lei não encontrados
  (Jundiaí 15/08, Itupeva, Jarinu, Cabreúva, Louveira, Várzea Paulista, Cajamar,
  Vinhedo, Valinhos, Franco da Rocha). As **datas** estão confirmadas; só o nome
  e a lei faltam.
- Falta ligar o cálculo ao checkout e à página de produto: depende da regra de
  **entrega própria por zona** (quantos dias cada cidade leva) e do prazo da
  transportadora (hoje vem do plugin; depois, do Melhor Envio direto).
