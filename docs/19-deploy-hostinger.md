# 19 — Deploy na Hostinger

## Objetivo

Padronizar o processo de publicação do projeto Next.js na Hostinger Cloud Professional.

## Ambiente

- Node.js LTS
- GitHub como repositório principal
- Variáveis de ambiente configuradas no servidor

## Processo

1. Atualizar a branch principal.
2. Executar:
   - npm install
   - npm run lint
   - npm run build
3. Corrigir qualquer erro antes do deploy.
4. Publicar a nova versão.
5. Validar o funcionamento em produção.

## Pós-deploy

Verificar:

- Home
- Busca
- Categorias
- Produto
- Carrinho
- Checkout
- Login
- SEO
- Analytics

## Rollback

Manter a versão anterior disponível para restauração rápida caso seja necessário.

## Monitoramento

Após cada deploy acompanhar:

- Logs
- Core Web Vitals
- Google Search Console
- GA4
