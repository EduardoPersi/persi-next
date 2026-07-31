# 26 — Arquitetura de URLs públicas

## Estrutura oficial

- Produto: `/{produto-slug}`
- Categoria principal: `/{categoria-slug}`
- Subcategoria: `/{categoria-pai}/{subcategoria}`
- Páginas institucionais e áreas funcionais preservam suas rotas na raiz.

Os prefixos `/produto/` e `/categoria/` existem somente como endpoints
legados de redirecionamento HTTP 301. Eles não renderizam conteúdo.

## Resolução e conflitos

O App Router usa um único resolvedor público para catálogo e páginas
institucionais. A prioridade é:

1. rotas estáticas e funcionais (`/api`, `/checkout`, `/carrinho`,
   `/minha-conta`, `/busca` e equivalentes);
2. páginas institucionais reservadas;
3. categorias cuja hierarquia completa corresponde à URL;
4. produtos, exclusivamente com um segmento na raiz;
5. página 404.

Uma categoria nunca é resolvida somente pelo último slug: toda a cadeia de
pais precisa corresponder. Isso impede aliases e conteúdo duplicado.

Se um produto colidir com uma categoria principal, a categoria tem
prioridade. Se categoria ou produto colidir com rota reservada, a rota
reservada tem prioridade. Itens conflitantes não entram no sitemap.

Antes de publicar novos slugs, executar:

```bash
npm run audit:urls
```

A auditoria consulta os slugs públicos do WooCommerce e relata conflitos
entre rotas reservadas, categorias e produtos. Um conflito deve ser resolvido
no cadastro antes da publicação; não se cria uma segunda URL indexável.

## Redirecionamentos

- `/produto/{slug}` → `/{slug}`
- `/categoria/{slug}` → caminho hierárquico canônico da categoria
- `/categoria/{pai}/{filha}` → `/{pai}/{filha}`
- o parâmetro legado `subcategoria` também é convertido para a hierarquia.

Os Route Handlers devolvem status HTTP 301 e preservam os demais parâmetros
de consulta aplicáveis.

## SEO

Canonical, Open Graph, Twitter Cards, BreadcrumbList, Product,
CollectionPage e sitemap usam apenas a estrutura oficial. O domínio
canônico é `https://persimateriais.com.br`.
