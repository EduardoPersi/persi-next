# 05 — Performance

## Objetivo
Garantir excelente desempenho e Core Web Vitals.

## Metas
- LCP < 2,5 s
- CLS < 0,1
- INP < 200 ms
- TTFB o menor possível

## Estratégias

### Server Components
Usar Server Components por padrão.

### Client Components
Somente para:
- interações;
- formulários;
- estado local.

### Imagens
- next/image
- WebP/AVIF
- sizes
- width/height
- priority apenas para a imagem LCP.

### Fontes
- next/font
- poucos pesos
- evitar CLS

### Scripts
Carregar scripts de terceiros somente quando necessários.

### Cache
Separar cache de:
- produtos
- categorias
- estoque
- carrinho
- checkout

### Bundle
Evitar bibliotecas grandes e código duplicado.

### Monitoramento
Acompanhar:
- PageSpeed
- Lighthouse
- Search Console
- GA4
- Core Web Vitals reais.

## Checklist
- sem layout shift
- imagens otimizadas
- CSS mínimo
- JavaScript reduzido
- lazy loading quando apropriado
