# Correções da página de produto — 18/09/2026

## Diagnóstico

- Reprodução em `npm run dev`, produto Alumbra DPS 45KA: React mostrou
  `Hydration failed because the server rendered text didn't match the client`.
  O diff apontou `FlashDealsTimer`: servidor `05:26`, cliente `05:21`.
- `useFlashDeals` também executava `window.location.reload()` ao expirar.
  Uma janela vencida em HTML/cache podia provocar reload logo após hidratar.
- Os cards já usavam `next/link` e URLs relativas canônicas. O listener global
  em captura interceptava esses links para mostrar o overlay. Isso, isoladamente,
  não prova reload: o listener usa `router.push`, também client-side.
- A descrição de fallback usava `description.slice(0, 240)` nos mappers da
  Store API e busca REST.
- A galeria já era sticky, mas a descrição completa estava fora do grid que
  limita sua extensão vertical.

## Alterações

- Cards de produto, ofertas e vistos recentemente usam prefetch explícito e
  `data-route-transition-skip`, deixando a navegação com o Link do Next.
- Timer com snapshot SSR estável e atualização RSC uma vez por janela vencida.
- Resumos preservam palavras completas e acrescentam `...` quando abreviados.
- Conforme ajuste solicitado, descrição/ficha técnica permanecem abaixo do grid,
  em largura completa. A imagem acompanha somente a coluna de preço, compra e
  frete. Sticky a partir de `lg`, top de 80 px, largura limitada pela altura
  disponível para acomodar imagem e miniaturas. Mobile permanece em fluxo normal.
- Galeria, painel e detalhes recebem chave por produto para reiniciar seleção,
  quantidade, variações e expansão ao navegar entre produtos.

## Pixel / GTM

O container publicado foi consultado somente para leitura. A tag base do Pixel
(tag 28) dispara em `gtm.js`; tags 33–36 chamam `fbq` diretamente para
AddToCart, ViewContent, InitiateCheckout e Purchase.

O script lazy do aplicativo inseria `gtm.js` **depois** de eventos React já
enfileirados. Agora a ordem é consentimento padrão, inicialização do GTM e
eventos pendentes. Nenhum evento é descartado ou duplicado e nenhum Pixel extra
é instalado.

Proteção adicional necessária no container externo: configurar sequenciamento
das tags Meta para executar a tag base antes dos eventos e não executar o evento
se a configuração falhar. Em cada HTML personalizado, proteger a chamada:

```js
if (typeof window.fbq === 'function') {
  window.fbq('track', 'ViewContent');
}
```

Aplicar o mesmo guard aos outros eventos, preservando seus parâmetros (inclusive
valor/moeda de Purchase). A função de fila criada pelo script base oficial pode
receber eventos antes do download de `fbevents.js` terminar. Não criar um stub
separado no Next: isso faria o script base pular o carregamento do Pixel.

O GTM externo não foi alterado/publicado. A correção local resolve a ordem de
inicialização identificada; o guard das tags depende dessa alteração externa.

## Validação

- `npm run dev`: reprodução do erro original e verificação após a correção.
- Chrome: galeria acompanhando a descrição expandida e parando no fim da
  coluna, inspeção das larguras 320, 375, 390, 768, 1024, 1280 e 1440 px.
- `npm run build`: aprovado; `npm run start -- --port 3002` usado para conferir
  também a versão de produção local. Sem novo erro de hidratação nos produtos
  Alumbra DPS 45KA e Alumbra IDR 4P 80A. Houve erro independente do Google One Tap
  (`FedCM ... AbortError`), não tratado nesta tarefa.
  O build registrou respostas 500 da Store API durante revalidação de cache,
  mas terminou com sucesso. Essa falha externa não foi corrigida nesta tarefa.
- Navegação local exercitada por Ofertas Relâmpago (DPS 45KA → IDR 4P 80A)
  e por teclado em Quem viu, viu também (IDR 4P 80A → DPS 45KA).
- `npm run typecheck`: aprovado. `npm run lint`: zero erros, 11 avisos em
  arquivos não alterados nesta tarefa.
- `npm test`: 1217/1218 passaram. Falha pré-existente em
  `tests/instagramFeed.test.mjs:109`, que espera `InstagramCarousel` embora o
  componente atual use `InstagramCarouselLazy`.
- Os sete testes focados em resumo, ordem GTM e isolamento de analytics em
  staging passaram. Sem commit, push ou publicação.

Não foi capturada uma comparação completa de requisições de chunks em produção
remota. A ausência de reload por expiração foi corrigida no código; a navegação
dos cards foi exercitada localmente. Se houver recarga apenas na hospedagem,
verificar respostas RSC e cache da infraestrutura separadamente.

## Ajuste solicitado e publicação

A descrição e ficha técnica voltaram para baixo, em largura completa. A galeria
acompanha apenas preço, compra e meios de envio. O `overflow-x: hidden` de
`html/body` foi substituído por `clip`: mantém o corte horizontal sem criar um
ancestral de rolagem que neutraliza o sticky.

Publicação preparada em worktree isolado, a partir de `origin/main` (`6f13d6b`),
contendo somente estas correções. Commits, alterações locais e migrações do PIM
não foram incluídos. A Hostinger está configurada para deploy automático da
branch `main` em `persimateriais.com.br`, usando Node 22.

Na árvore limpa da `main`, os dois testes de regressão específicos passaram.
A suíte completa dessa base executou 547 testes: 525 passaram e 22 falharam em
testes fora desta alteração, incluindo PIM dependente de artefatos locais
`supabase/.temp/pim-ai` ausentes e o teste legado de Instagram. Não foram
incluídas correções de infraestrutura de testes/PIM neste deploy.

Validação final da versão isolada: build e TypeScript aprovados; lint com zero
erros e três avisos preexistentes. Chrome local em 1440 px confirmou descrição
em largura completa abaixo do grid e galeria sticky em 80 px durante a área de
frete; em 390 px, scrollWidth igual à largura disponível (sem overflow horizontal).
