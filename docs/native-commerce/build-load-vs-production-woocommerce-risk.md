# Risco: build martela o WooCommerce de produção (Store API 500)

Status: risco registrado, **nenhuma mitigação implementada**.

## O problema

`next build` gera páginas estáticas/SSG em paralelo usando vários
workers (os logs de build mostraram "63 workers" — esse número bate com
a contagem de CPUs da própria máquina de build da Hostinger, que é o
default do Next quando nada limita isso explicitamente). Páginas com
`generateStaticParams` amplo (`marca/[slug]`, `materiais-eletricos/[cidade]`,
`materiais-hidraulicos/[cidade]`) mais as chamadas de catálogo
(`products`, `products/categories`, `products/brands` via Store API)
disparam um volume grande de requisições **simultâneas** contra o mesmo
WordPress/WooCommerce real (`loja.persimateriais.com.br` — não existe
Woo de staging separado). O resultado observado: `StoreApiError` com
HTTP 500 vindo da própria Store API sob essa carga.

Isso afeta **os dois ambientes**, não só staging: produção também roda
`next build` (via Git auto-deploy na `main`) contra o mesmo WordPress.
Staging só é onde eu observei o sintoma até agora porque foi onde rodei
builds manualmente com mais frequência nesta engajamento.

## Mitigações possíveis (não implementadas)

**1. Limitar a concorrência do build (`next.config.ts`)**
Next expõe uma opção (`experimental.cpus` nas versões recentes) para
capar quantos workers de geração estática rodam em paralelo, independente
de quantas CPUs a máquina de build tiver.
- Impacto: build mais lento (menos paralelismo), mas cada worker ainda
  faz as mesmas chamadas de sempre — só reduz o pico de concorrência
  contra o WordPress.
- Afeta staging e produção igualmente (mudança no `next.config.ts`,
  compartilhado pelos dois).
- Reversível trivialmente (é um número num arquivo de config).

**2. Reduzir o que é gerado estaticamente no build**
Hoje `marca/[slug]`, `materiais-eletricos/[cidade]`,
`materiais-hidraulicos/[cidade]` provavelmente geram (quase) todas as
combinações no build via `generateStaticParams`. Reduzir essa lista
(gerar só as combinações comercialmente mais acessadas) e deixar o
resto cair em ISR on-demand (`dynamicParams: true`, primeira visita gera
sob demanda) tira essas páginas do pico inicial do build.
- Impacto: build mais rápido e mais leve para o Woo; primeira visita a
  uma combinação "fria" fica um pouco mais lenta (gera na hora), depois
  cacheia normalmente.
- Afeta staging e produção igualmente (é o mesmo código de rota).
- Reversível (é decidir quais params `generateStaticParams` retorna).

**3. Limitador de concorrência só para as chamadas de build ao Woo**
Um semáforo simples (sem dependência nova) envolvendo especificamente
`storeApiGet`/`storeApiGetWithMeta`/`restApiGetWithMeta`, ativo só
durante `next build` (detectável via `NEXT_PHASE=phase-production-build`),
limitando quantas requisições concorrentes saem para o mesmo
`WORDPRESS_URL` independente de quantos workers do Next existem.
- Impacto: mais preciso que a opção 1 (não penaliza o resto do build,
  só as chamadas ao Woo), mas é mais código novo para revisar/testar.
- Afeta staging e produção igualmente (é lógica dentro dos próprios
  clients Woo, compartilhados).
- Reversível (é remover o wrapper).

## Recomendação preliminar (não decidida, não implementada)

As opções 1 e 2 são as menores e mais baratas de reverter; a 3 é a mais
cirúrgica mas com mais superfície de código novo. Nenhuma foi
implementada — fica para decisão e autorização separada.
