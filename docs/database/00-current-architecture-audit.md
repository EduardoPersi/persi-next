# Auditoria da arquitetura atual — Persi Database V1

> Fase A concluída em 23/08/2026. Este documento descreve o repositório e a
> árvore de trabalho local; não cria banco, não executa migration e não altera
> nenhum fluxo de produção.

## 1. Resumo executivo

O projeto é um monólito Next.js 16 com App Router que atua como storefront e
Backend for Frontend (BFF) para WordPress/WooCommerce. O WooCommerce continua
sendo a fonte de verdade de catálogo, carrinho, clientes, pedidos, preços,
estoque, cupons, frete e parte da autenticação. O Next.js acrescenta páginas,
cache público, validação, sessão própria assinada, orquestração do checkout e
integrações diretas com Banco Inter e PagBank.

Não existe hoje camada PostgreSQL/Supabase, ORM, driver SQL, migration SQL ou
variável de conexão com banco no código versionado. A nova base pode, portanto,
ser criada em paralelo sem substituir uma abstração de banco consolidada.

O checkout atual já contém decisões que precisam ser preservadas: carrinho da
Store API isolado por `Cart-Token`, dados privados sem cache, tentativa de
checkout idempotente persistida no WordPress, pedido criado no WooCommerce e
cobranças tratadas no servidor. Qualquer futura escrita dupla ou cutover que
ignore essas fronteiras pode duplicar pedidos/cobranças ou perder sessão.

Há um ativo local importante em `wordpress-plugin/persi-catalog-engine/`: um
plugin 1.2.1 com cliente Olist, validação de GTIN, descoberta de atributos e
parser de medidas compostas. Entretanto, toda essa pasta e o ZIP correspondente
estavam **não rastreados** no momento da auditoria. Eles são evidência da árvore
local e candidatos à reutilização, mas não podem ser tratados como baseline do
repositório até serem revisados e versionados separadamente.

## 2. Escopo, método e limitações

Foram examinados:

- arquivos de configuração, lockfile, scripts, tipos e testes;
- estrutura completa de `app/`, `components/`, `lib/`, `services/`, `types/`,
  `scripts/`, `tests/`, `cloudflare/` e `wordpress-plugin/`;
- documentação obrigatória `docs/00` a `docs/09`;
- documentação específica de API, autenticação, segurança, deploy, carrinho,
  checkout, frete, pagamentos e incidentes;
- clientes WooCommerce Store API e REST v3, rotas privadas e políticas de cache;
- plugins WordPress próprios e suas tabelas auxiliares;
- nomes das variáveis em `.env.example`, sem ler ou registrar valores secretos.

Não foram consultados bancos remotos, Supabase, painel WordPress, Hostinger,
Cloudflare, Banco Inter, PagBank ou Olist. Assim, esta auditoria comprova o que o
código espera, mas não comprova versões, plugins, tabelas ou configurações
efetivamente instaladas nos ambientes remotos.

## 3. Stack encontrada

| Item | Evidência atual | Observação para a nova camada |
| --- | --- | --- |
| Next.js | `16.3.1`, App Router | Rotas e páginas ficam em `app/`; APIs já formam um BFF. |
| React | `19.2.4` | Server Components são o padrão documental. |
| TypeScript | `^5`, `strict: true`, `noEmit: true` | Não há script `typecheck`; `next build` faz a checagem integrada. |
| Node | Política do projeto: LTS; máquina auditada: `v26.5.0` | Não há `engines`, `.nvmrc` ou `.node-version`; a versão de produção não é comprovável pelo Git. Fixar uma LTS antes do acesso a banco. |
| Package manager | npm, `package-lock.json` v3; npm local `11.17.0` | Usar npm e manter o lockfile. |
| ESLint | ESLint 9 + `eslint-config-next` 16.3.1 | Script: `npm run lint`. |
| Testes | `node:test`; 51 arquivos `*.test.mjs` | Não há framework de teste de banco nem ambiente Supabase local. |
| CSS/UI | Tailwind CSS 4, Lucide, Swiper | Sem impacto direto na Fase A. |
| Validação | Zod 4 e validações manuais | Candidata a validar DTOs da futura camada. |
| HTTP | `fetch` nativo e Axios (Banco Inter) | Não adicionar outro cliente sem necessidade. |
| Banco/ORM | Nenhum | Decisão deve ser tomada somente na Fase B, via ADR. |

Outras dependências relevantes: React Hook Form, TanStack Query, `qrcode`,
`sanitize-html`, `server-only` e `clsx`.

## 4. Organização atual

```text
app/                     páginas App Router e Route Handlers (BFF)
components/              UI e componentes por domínio visual
context/ e hooks/        estado/interação no cliente
lib/                     autenticação, comércio, validação e utilitários
services/
  woocommerce/           Store API, REST v3 e endpoints Persi
  checkout/              checkout headless e identidade
  payments/              Banco Inter, PagBank e reconciliação
  shipping/              consulta de CEP
  account/               workspace e sessão da conta
  wordpress/             conteúdo editorial
types/                   contratos reutilizados no front e BFF
tests/                   testes estáticos/unitários com node:test
wordpress-plugin/        extensões próprias executadas no WordPress
cloudflare/              proxy específico do checkout
scripts/                 auditorias e operações manuais de staging
```

Não há hoje diretórios `supabase/`, `database/`, `repositories/` ou uma camada
de domínio independente do WooCommerce. A separação existente é principalmente
por serviço externo/feature, e não por domínio com portas e adaptadores.

## 5. Fluxos e fontes de verdade atuais

### 5.1 Catálogo, produtos, categorias, marcas e busca

- `services/woocommerce/client.ts` acessa publicamente
  `/wp-json/wc/store/v1`, com timeout de 10 s, retry único para falhas
  transitórias e revalidação padrão de 120 s.
- `services/woocommerce/products.ts` centraliza listagem, produto por slug,
  variações e ordenação por disponibilidade. Respostas externas são filtradas e
  convertidas pelos type guards/mapeadores de `services/woocommerce/mappers.ts`.
- `services/woocommerce/categories.ts`, `brands.ts`, `filters.ts` e `search.ts`
  compõem categorias, marcas, filtros e sugestões.
- `services/woocommerce/restClient.ts` acessa `/wp-json/wc/v3` somente no
  servidor, usando consumer key/secret para dados privados ou não expostos pela
  Store API.
- `services/wordpress/` consome conteúdo editorial via API WordPress.
- Rotas públicas são preservadas por `app/[...segments]/page.tsx`, páginas de
  storefront em `app/_storefront/`, rotas explícitas de busca/carrinho/checkout,
  `robots.ts` e `sitemap.ts`.

Conclusão: WooCommerce/WordPress são as fontes atuais. Os tipos `Product`,
`Category`, `Brand`, `ProductFamily`, filtros e os mapeadores são bons contratos
de compatibilidade para futuros adaptadores PostgreSQL, mas não constituem um
modelo persistente completo.

### 5.2 Carrinho e cupons

- O carrinho usa WooCommerce Store API e é encapsulado por
  `services/woocommerce/cart.ts` e pelas rotas `app/api/cart/*`.
- O token retornado pelo Woo é mantido em cookie HTTP-only pelo BFF; o browser
  não é a autoridade de preço, estoque, descontos ou totais.
- Itens, quantidade e cupons são mutações `no-store`; respostas privadas usam
  `Cache-Control: private, no-store, no-cache, must-revalidate` e `Vary: Cookie`.
- `CartProvider` e `useCart` administram a experiência no cliente, mas o estado
  comercial continua no WooCommerce.
- Frete e endereço alteram o carrinho/sessão Woo, portanto dependem da afinidade
  correta com o mesmo `Cart-Token`.

### 5.3 Checkout e pedidos

O repositório contém dois caminhos compatíveis com a operação atual:

1. transferência/híbrido para o checkout WooCommerce, usando payload assinado,
   token descartável e restauração de carrinho pelo plugin
   `persi-headless-checkout`;
2. checkout Next, que valida dados no servidor, recalcula o carrinho no Woo,
   reserva uma tentativa idempotente, cria o pedido via REST v3 e então cria a
   cobrança.

`services/checkout/headlessCheckout.ts`, `lib/commerce/checkoutTransfer.ts`,
`lib/commerce/checkoutAttempt.ts` e `app/api/checkout/*` são as principais
fronteiras. A tentativa usa UUID/idempotency key, lease e transições como
`RESERVED`, `ORDER_CREATED`, `PAYMENT_CREATING` e `PAYMENT_CREATED`.

O plugin `persi-headless-checkout` 0.6.0 persiste no MySQL do WordPress:

- `wp_persi_checkout_transfers` (prefixo real é configurável), com hashes,
  payload, expiração, uso e tentativas;
- `wp_persi_checkout_attempts`, com `checkout_attempt_id` único, pedido,
  provedor, método, referência externa, estado e lease.

O pedido final permanece um `WC_Order`. Dados de idempotência, referência de
pagamento e posse/identidade também são anexados por metadados do WooCommerce.
Esses identificadores e estados precisam entrar no futuro mapeamento legado.

### 5.4 Pagamentos

- Existe interface `PaymentGateway` em `services/payments/gateway.ts`.
- Banco Inter está implementado no servidor para Pix e boleto, com OAuth/mTLS,
  certificados em variáveis privadas, consulta de status e webhooks.
- PagBank está implementado para cartão por token/chave pública; PAN completo e
  CVV não são persistidos pelo código auditado.
- `app/api/checkout/payment/route.ts` orquestra pedido + cobrança e reutiliza a
  idempotency key como base do `txid` Pix.
- `app/api/webhooks/inter` e `app/api/webhooks/pagbank` recebem atualizações;
  polling e reconciliação funcionam como recuperação quando webhook atrasa.
- `app/api/cron/expire-pending-payments` trata expiração de pagamentos
  pendentes, protegido por segredo.

A futura base não pode criar uma segunda cobrança só porque ainda não recebeu a
escrita ou webhook do sistema atual. A chave de idempotência, `woo_order_id`,
provider reference/txid e estado do checkout precisam ter unicidade e uma regra
de reconciliação explícita.

### 5.5 Frete

- `services/shipping/postcode.ts` consulta ViaCEP sem cache.
- `app/api/shipping/product`, `app/api/shipping/cart` e
  `app/api/checkout/shipping` delegam cálculo comercial ao WooCommerce/Store
  API, preservando sessão e métodos configurados no WordPress.
- A documentação registra dependência de regras/plugins atuais, inclusive
  Melhor Envio, e incidentes de checkout híbrido relacionados à sessão/frete.

Não existe tabela própria de transportadoras, métodos ou cotações no Next.js.
Não se deve inferir do código quais plugins de frete estão ativos em produção.

### 5.6 Autenticação, clientes e conta

- O usuário canônico atual é o usuário/cliente WordPress/WooCommerce.
- O Next mantém cookie HTTP-only assinado/JWT e proxy de endpoints de conta.
- Há login/senha, recuperação, Google OAuth, Google One Tap e Facebook OAuth.
- `persi-headless-account` 1.0.6 fornece endpoints e integra as identidades ao
  usuário WordPress; pedidos são lidos via `wc_get_orders` e verificados por
  proprietário.
- O plugin possui tabelas auxiliares para listas do cliente, rate limiting e
  identidades OAuth com subjects/e-mails em hash.
- Endereços e perfil continuam no cadastro WooCommerce; pedidos históricos são
  apresentados a partir de `WC_Order`.

Não há Supabase Auth. Adotá-lo ou duplicar usuários nesta fase geraria duas
fontes de identidade. A decisão de identidade futura deve incluir mapeamento
`wp_user_id`/`woo_customer_id`, vinculação de provedores e migração de sessão.

### 5.7 Integração ERP

Não há integração ERP versionada na baseline rastreada pelo Git. A documentação
histórica menciona Bling como integração operacional do WooCommerce.

Na árvore local não rastreada, `persi-catalog-engine` 1.2.1 integra Olist por
OAuth para pesquisa de produto e sincronização conservadora de GTIN no campo
oficial do WooCommerce. Ele inclui retry/backoff, circuit breaker, snapshots com
TTL, auditoria de runs, detecção de conflitos, dry-run e descoberta de
atributos. O escopo atual é catálogo/GTIN/PIM auxiliar; não é uma integração
completa de pedidos ou estoque e não escreve no futuro PostgreSQL.

## 6. Cache e revalidação

| Classe de dado | Estratégia encontrada |
| --- | --- |
| Catálogo Store API | revalidate padrão de 120 s; variações 30 s |
| Menu | `unstable_cache`, tag própria e revalidação |
| Recomendações/compre junto | `unstable_cache`, 120 s |
| Ofertas | `unstable_cache` e revalidação específica |
| Conteúdo WordPress | normalmente 3.600 s |
| Sitemap/carga ampla | 86.400 s |
| Preço/estoque no fluxo de compra | recalculados no Woo; operações sem cache |
| Carrinho, checkout, conta, pedido e pagamento | `private`, `no-store`, cookies e/ou `force-dynamic` |

Há diagnóstico opcional de fan-out WooCommerce via `WOO_REQUEST_DIAGNOSTICS`.
O relatório existente aponta amplificação de chamadas em algumas páginas. Um
adaptador PostgreSQL futuro deve evitar reproduzir N+1 e precisa distinguir
claramente leitura pública cacheável de estado transacional.

## 7. Schemas, tipos e validação reutilizáveis

Ativos úteis:

- `types/product.ts`, `woocommerce.ts`, `woocommerce-rest.ts`, `category.ts`,
  `brand.ts`, `productFamily.ts` e `catalog-filters.ts`;
- `types/cart.ts`, `checkout.ts`, `payments.ts` e `shipping.ts`;
- mapeadores e type guards em `services/woocommerce/mappers.ts`;
- validação financeira em `lib/payments/`, validação de documentos/telefone e
  schemas de checkout;
- retry de rede e erros tipados dos clientes WooCommerce/pagamento;
- estado idempotente e leases do checkout atual;
- no plugin local de catálogo: `GtinValidator`, `CompositeDimensionParser`,
  `ValueNormalizer`, dicionário canônico, aliases e regras de descoberta.

Limitações:

- tipos da Store API descrevem DTOs do Woo e não devem virar tabelas por cópia;
- validação externa é mista (type guards, parsing manual e Zod), portanto ainda
  não há um schema canônico único;
- valores monetários no front são frequentemente representados em minor units,
  enquanto APIs de PSP/Woo têm contratos próprios; o futuro banco deve definir
  uma única política sem `float` SQL;
- o parser PIM local precisa de testes com o catálogo real antes de definir o
  modelo PostgreSQL de medidas compostas.

## 8. Variáveis de ambiente e segredos

`.env.local` está ignorado e não teve valores inspecionados. `.gitignore`
protege `.env*` exceto `.env.example`, além de certificados e chaves comuns.

Grupos declarados em `.env.example`:

- WordPress/WooCommerce e endpoints HMAC Persi;
- flags do checkout e staging;
- Banco Inter (URL, client credentials, certificado, chave privada e chave Pix);
- PagBank (URL, segredo e chave pública do browser);
- Google/Facebook OAuth;
- GTM, reCAPTCHA, Instagram, cron e URL canônica da aplicação.

Não existem ainda `DATABASE_URL`, `DIRECT_URL` ou variáveis Supabase. Na Fase B,
somente nomes comprovadamente necessários devem ser adicionados. Conexão direta
de migration e conexão de runtime/pooler não devem ser confundidas. Service role,
se escolhida, deve permanecer server-only e nunca usar prefixo `NEXT_PUBLIC_`.

## 9. Persistências próprias existentes no WordPress

Além das tabelas nativas de WordPress/WooCommerce e metadados, os plugins criam
persistência operacional auxiliar. As mais relevantes são:

- checkout transfers e checkout attempts;
- customer lists, account identities e account rate limits;
- inscrições de estoque, nonces e newsletter;
- configurações, locks, tokens e versões em `wp_options`;
- na árvore local não rastreada do catálogo: runs, run items, logs, cache Olist,
  candidatos, mapeamentos e aliases de atributos.

Essas tabelas são MySQL/WordPress, usam `$wpdb`/`dbDelta` e não possuem foreign
keys equivalentes ao futuro PostgreSQL. Devem ser fontes de migração/mapeamento,
não templates SQL copiados. A ativação de plugins contém operações de upgrade
potencialmente destrutivas sobre tabelas legadas; nenhuma delas foi executada.

## 10. Riscos arquiteturais

### Críticos

1. **Duas autoridades transacionais.** Escrever pedido, estoque ou pagamento no
   PostgreSQL antes de definir ownership, idempotência e compensação pode gerar
   divergência financeira.
2. **Identidade duplicada.** WordPress hoje é a autoridade de clientes e OAuth;
   introduzir Supabase Auth implicitamente criaria contas/sessões paralelas.
3. **Sessão do carrinho/frete.** O `Cart-Token` liga Store API, endereço, frete e
   checkout. Uma leitura paralela não pode alterar ou perder esse estado.
4. **IDs legados.** Produto, variação, cliente e pedido usam IDs Woo/WordPress em
   muitos contratos. O futuro banco precisa de PK interna e mappings únicos.
5. **Webhook e retry.** A deduplicação atual está centrada na tentativa/pedido
   Woo; uma segunda persistência exige uma caixa de entrada idempotente própria.

### Altos

6. A versão Node de produção não está fixada no repositório.
7. Não há ferramenta/método de migration PostgreSQL decidido nem testes locais
   de banco.
8. O código local Olist/PIM não está versionado; depender dele agora tornaria o
   design não reproduzível.
9. APIs externas têm DTOs parcialmente validados; dados incompletos e encoding
   histórico precisam entrar no importador por staging.
10. Cache de catálogo e consistência de preço/estoque possuem SLAs diferentes;
    uma política única seria incorreta.
11. Dados pessoais ficam hoje distribuídos entre WordPress, WooCommerce,
    plugins e provedores. Retenção/anonymização precisam considerar obrigações
    fiscais, não apenas exclusão de cliente.

### Moderados

12. Alguns logs REST incluem corpo de erro do WooCommerce; antes de introduzir
    payloads do novo banco, a política de redaction deve ser centralizada.
13. Testes atuais cobrem extensamente contratos e segurança do checkout, mas são
    majoritariamente unitários/estáticos; não substituem testes de concorrência,
    constraint e RLS em PostgreSQL real local.
14. A integração de frete instalada em produção não pode ser inferida apenas do
    Next.js; exige inventário operacional posterior, sem mudar a Fase A.

## 11. Incompatibilidades e lacunas frente ao Blueprint V1

| Requisito futuro | Estado atual |
| --- | --- |
| PostgreSQL/Supabase | Ausente |
| Migrations versionadas | Ausentes para PostgreSQL; plugins usam upgrades MySQL próprios |
| DAL/ORM | Ausente; decisão pendente de ADR |
| Domínios catálogo/PIM/preço/estoque próprios | WooCommerce é a autoridade |
| Clientes/pedidos/pagamentos próprios | WooCommerce + PSPs são as autoridades |
| RLS | Não aplicável ainda; nenhuma policy Supabase existe |
| Pooling | Não definido |
| Importador Woo com staging | Ausente |
| Legacy mappings PostgreSQL | Ausentes |
| Auditoria/observabilidade de plataforma | Parcial e distribuída |
| Olist | Protótipo/plugin local não rastreado, focado em catálogo |
| Testes de banco | Ausentes |

Nenhuma dessas lacunas é motivo para alterar a produção na Fase A.

## 12. Pontos que não devem ser alterados

- clientes e mapeadores WooCommerce usados pelas páginas atuais;
- cookie e propagação de `Cart-Token`;
- rotas públicas, slugs, sitemap, robots, metadata e canonicals;
- políticas `private/no-store` de carrinho, checkout, conta e pagamento;
- criação de `WC_Order`, idempotência/lease e reconciliação atuais;
- integrações Banco Inter, PagBank, frete e webhooks;
- autenticação WordPress e cookies assinados;
- plugins e tabelas WordPress em produção;
- configuração Cloudflare/Hostinger;
- flags de ativação e rollback do checkout.

A futura implementação deve ser aditiva, server-only e desligada dos fluxos
públicos até autorização expressa de shadow read, dual write ou cutover.

## 13. Recomendação para a Fase B

Não foi identificado bloqueio crítico que impeça **desenhar** a arquitetura em
paralelo. A Fase B pode produzir blueprint, ER diagram, plano de migrations e o
ADR de acesso ao banco sem instalar dependências ou conectar ambientes.

Decisões que o ADR deve resolver com evidência atualizada:

1. SQL tipado/driver versus ORM, considerando Next 16, Node LTS, migrations
   auditáveis e Supabase;
2. UUID disponível no PostgreSQL/Supabase escolhido e política de geração;
3. conexão de runtime via pooler versus conexão direta de migrations;
4. acesso exclusivamente server-side e uso (ou não) do cliente Supabase;
5. estratégia de teste local reproduzível e guardas contra production;
6. separação inicial dos schemas/módulos e ownership transacional;
7. contrato de `external_mappings` para Woo, Olist, Inter e PagBank;
8. identidade futura sem assumir adoção de Supabase Auth.

Antes da Fase C, devem ser checkpoints explícitos: versionar/rejeitar o plugin
local Olist/PIM, fixar uma versão Node LTS suportada pelo hosting e aprovar a
ferramenta de acesso/migrations. Nenhuma dessas decisões deve ser implícita.

## 14. Checkpoint da Fase A

- **Arquivo criado:** `docs/database/00-current-architecture-audit.md`.
- **Arquivos alterados:** nenhum arquivo preexistente.
- **Migrations criadas:** nenhuma.
- **Dependências instaladas:** nenhuma.
- **Testes executados:** não aplicável a código; foi feita inspeção estática e
  conferência do estado Git. Lint/build não são necessários para um Markdown
  isolado e serão exigidos nas fases de implementação.
- **Riscos:** listados nas seções 10 e 11.
- **Pendências:** documentos e decisões da Fase B; confirmação operacional dos
  ambientes remotos permanece fora desta auditoria estática.
- **Produção:** não foi acessada nem alterada.
