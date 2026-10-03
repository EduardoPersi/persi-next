# 43 — Produtos e preços ao vivo para o painel de atendimento

## Para que serve

O atendimento acontece no WhatsApp, e quem atende precisa dizer o preço. Hoje
ele abre o site num navegador, procura, copia o nome, copia o preço, copia o
link e cola na conversa — e, quando tem pressa, manda de cabeça. Preço de
cabeça é a loja prometendo o que pode não cumprir, por escrito.

Esta rota é o caminho para o painel (`persi-atendimento`) perguntar o preço
**na hora de usar**.

| Direção | Quem chama | Para quê | Documento |
| --- | --- | --- | --- |
| site → painel | site | pedir envio de mensagem no WhatsApp | `42-painel-whatsapp.md` |
| painel → site | painel | ler catálogo com preço ao vivo | **este** |

## A decisão que manda em tudo aqui

O banco do catálogo está saindo do WooCommerce para o Supabase. **O painel não
pode sentir essa troca.**

Por isso o contrato é uma forma própria (`ProdutoParaOPainel`), e não o
`Product` do site: enquanto o nome dos campos daqui não mudar, as tripas podem
ser trocadas inteiras sem o atendimento parar. Quando o Supabase assumir, muda
`services/...` dentro desta rota — e mais nada.

## O contrato

`GET /api/painel/produtos?q=<busca>&limite=<1..20>`
com `X-Painel-Key: <PAINEL_API_KEY>`.

```json
{
  "produtos": [
    {
      "id": 42,
      "sku": "CIM-50",
      "nome": "Cimento CP II 50kg",
      "marca": "Votoran",
      "preco_centavos": 3890,
      "preco_de_centavos": null,
      "em_promocao": false,
      "unidade": "saco",
      "disponivel": true,
      "link": "https://persimateriais.com.br/cimento-cp-ii-50kg",
      "imagem": "https://.../cimento.jpg"
    }
  ],
  "em": "2026-10-03T18:40:12.000Z"
}
```

### Por que cada decisão

**Preço em CENTAVOS, inteiro.** Dinheiro em ponto flutuante arredonda errado:
`19.99 * 100` dá `1998.9999999999998`, e um truncamento entrega R$ 19,98 ao
cliente. Quem formata é o painel.

**`em_promocao` só quando o preço cheio é MAIOR que o cobrado.** O catálogo já
devolveu `onSale: true` com os dois preços iguais; seguir esse campo faria o
atendente mandar "de R$ 38,90 por R$ 38,90".

**`unidade` pode ser `null`, e `null` quer dizer "o cadastro não informa"** —
não "é unidade avulsa". Hoje a unidade não é campo do produto: quando existe,
está como atributo. Preencher por conta é a loja afirmando o que não sabe.

**Produto sem estoque SAI na lista, marcado.** Sumir seria pior: o atendente
procuraria, não acharia, e diria ao cliente que a loja não trabalha com aquilo.

**O link é absoluto e do site de hoje.** O `permalink` do catálogo ainda pode
apontar para o domínio antigo do WordPress, e mandar o cliente para lá é
mandá-lo para uma loja que não é mais a loja. A URL é **plana**
(`/cimento-cp-ii-50kg`), como o site preservou do WordPress — um `/produto/`
escrito à mão daria 404.

**`em` é quando o preço foi lido.** O painel mostra isso ao atendente: preço na
tela sem hora não deixa ninguém perceber que a consulta ficou velha.

**Não há campo de validade, e não há cache.** `force-dynamic` e
`revalidate = 0`. O contrato não dá nenhum convite a guardar o preço, porque
preço guardado é preço de ontem dito com a confiança de hoje.

## A chave

```
PAINEL_API_KEY=<a mesma cadastrada no cofre de Integrações do painel>
```

Somente servidor, nunca com prefixo `NEXT_PUBLIC_`.

**É outra chave, e não a `SITE_WEBHOOK_KEY`.** As duas ligações vão em
direções opostas e carregam coisas diferentes: aquela deixa o site PEDIR o
envio de uma mensagem; esta deixa o painel LER o catálogo com preço. Chave
única para as duas faria vazar uma ponta entregar as duas coisas, e trocar a
chave por causa de um incidente derrubaria o que não tinha nada a ver.

A comparação é `timingSafeEqual` sobre o hash dos dois lados: `===` em segredo
vaza por quanto demora, porque quem adivinha mede a diferença entre errar no
primeiro caractere e errar no último. O hash também é o que impede uma chave de
tamanho diferente de **derrubar a rota com 500** — `timingSafeEqual` lança
quando os lados têm tamanhos diferentes.

**Sem `PAINEL_API_KEY` no ambiente, nada passa.** Um site recém-publicado
responde 401 a todo mundo, e não "autorizado" a quem mandar o cabeçalho vazio.

## Respostas

| Status | Quando | O painel deve |
| --- | --- | --- |
| 200 | achou (inclusive lista vazia) | mostrar |
| 400 | busca com menos de 2 ou mais de 100 caracteres | corrigir o pedido |
| 401 | chave errada, ou site sem chave | **não** tentar de novo |
| 429 | mais de 120 consultas por minuto | esperar |
| 502 | o catálogo lá atrás não respondeu | pode tentar de novo |

O 502 é distinto do 500 de propósito: o painel precisa separar "o site está
fora" de "o site recusou" para saber se adianta insistir.

## O que esta rota NÃO é

Ela não substitui `/api/search/suggestions`, que continua intocada. Aquela é
**pública**, serve a caixa de busca de quem está comprando e devolve o que
convém a uma lista de sugestões. Esta é autenticada, devolve preço cheio,
preço promocional, disponibilidade e SKU, e vai mudar conforme o atendimento
precisar — sem que mexer nela possa quebrar a busca de um cliente.

## A prova

```
npm run test:painel
```

Ao contrário, com treze defeitos plantados: site sem chave deixando todo mundo
entrar, a comparação virando `===`, a comparação sobre bytes crus (que estoura
com chave de outro tamanho), a chave do webhook servindo de reserva, preço em
ponto flutuante, promoção seguindo o `onSale`, o link voltando para o
WordPress antigo, o link ganhando um `/produto/` inexistente, unidade virando
palpite, a rota cacheando preço, a conferência da chave desligada com a ordem
intacta, produto sem estoque sumindo da lista, e um campo de validade no
contrato — que é um convite a guardar preço.

Dois deles não mudam resposta nenhuma e por isso são conferidos no **fonte**:
trocar `timingSafeEqual` por `===` e desligar a guarda com `if (false && …)`.
Um defeito invisível para todo teste de comportamento some de vista na
primeira "simplificação".
