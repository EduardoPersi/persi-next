# Mega Menu dinâmico

## Objetivo

O Header consome categorias e marcas exclusivamente do WooCommerce. Não há
cadastro manual de categorias no front-end.

## Fluxo de dados

`WooCommerce Store API → services/menu → unstable_cache → NavigationProvider → desktop/mobile`

- `services/menu/menu.ts` carrega todas as páginas de categorias e marcas.
- `lib/navigation/CategoryTree.ts` converte a lista plana em uma árvore sem
  limitar profundidade e preserva a ordem recebida da API.
- O layout raiz faz uma leitura no servidor e distribui dados serializáveis aos
  componentes interativos.
- Desktop exibe até cinco colunas, imagem ou placeholder, contagem e submenus
  laterais recursivos.
- Mobile usa accordion recursivo com áreas de toque independentes para abrir a
  categoria ou expandir seus filhos.

## Cache e fallback

O menu usa `unstable_cache`, revalidação de 300 segundos e a tag
`woocommerce-mega-menu`. O cache do Next evita novas consultas em cada
navegação. Se uma atualização falhar, o Data Cache continua sendo a camada
persistente e o serviço também conserva em memória o último resultado válido da
instância. Sem qualquer resultado anterior, o Header permanece funcional e
mostra uma mensagem neutra no menu mobile.

## Atualizações automáticas

Categorias criadas, renomeadas, movidas ou removidas aparecem após a próxima
revalidação, incluindo slug, descrição, imagem, pai e contagem retornados pelo
WooCommerce. A ordem exibida é a ordem entregue pela API.

## Webhook futuro

`services/menu/cache.ts` exporta `invalidateMegaMenuCache()`. Um futuro Route
Handler deve validar assinatura, segredo e evento do webhook antes de chamar
essa função. Não existe endpoint público nesta etapa para evitar uma rota de
invalidação sem autenticação.

## Promoções e marcas

Marcas são carregadas automaticamente e as oito com maior quantidade de
produtos aparecem como destaque. A coleção `promotions` já faz parte do
contrato do menu e da interface; banners poderão ser preenchidos por uma fonte
administrável no WordPress sem alterar os componentes visuais.
