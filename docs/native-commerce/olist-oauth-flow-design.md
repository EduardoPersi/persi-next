# Fluxo OAuth2 — Apps Olist ERP v3 (design, sem código)

Status: **design only, not implemented**. Cobre a autorização e manutenção
de token dos dois "Aplicativos" OAuth v3 já decididos em
[`olist-integration-design.md`](olist-integration-design.md) §14.3 (**Persi
Native Sync — Catálogo**, leitura; **Persi Native Sync — Pedidos**, leitura
+ incluir/editar). Não cobre a integração "Ecommerce da Olist"/"Token API"
(§14.7), que não usa este fluxo (token estático, gerado uma vez no painel,
nunca entra no código).

## 1. Tipo de grant

**Authorization Code**, sobre um realm Keycloak/OIDC do Olist — já
confirmado neste projeto em duas fontes independentes: a documentação
pública ([Aplicativos API V3 — Central de Ajuda](https://ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao))
e o plugin `wordpress-plugin/persi-catalog-engine`, já em produção, que
autentica o app "Catálogo"/GTIN pelo mesmo mecanismo
(`src/Api/Configuration.php:8-9`):

- Autorização: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth`
- Token/refresh: `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token`
- Access token: ~4h. Refresh token: ~1 dia (fonte não-oficial, **A
  CONFIRMAR_OLIST** — tratar como estimativa, não garantia; o desenho
  abaixo não assume um valor exato).

Dois pares `client_id`/`client_secret` independentes (Catálogo e Pedidos —
`olist-integration-design.md` §14.3), cada um com seu próprio ciclo de
autorização/refresh — nunca compartilhados.

## 2. Autorização inicial — feita pelo dono, uma vez por app/ambiente

Fluxo manual, disparado por uma rota administrativa autenticada (mesmo
gate de sessão admin já usado em `/admin/*`, nunca uma rota pública):

1. Dono acessa `/admin/integrations/olist/connect?app=catalogo|pedidos` no
   navegador, autenticado como admin.
2. A rota gera `state` e (se o endpoint de autorização do Olist aceitar
   PKCE — **A CONFIRMAR_OLIST**, Keycloak em geral suporta, mas não visto
   documentado especificamente para este realm) `code_verifier`/
   `code_challenge`, reaproveitando os helpers já existentes e testados em
   `lib/account/oauth/state.ts` (`generateOAuthValue`, `createOAuthPkce`,
   `safeOAuthEqual`) — mesmo padrão já usado pelo login social (Google,
   `lib/account/oauth/google.ts`), só que para autorizar um app de
   integração, não um usuário.
3. Redireciona para o endpoint de autorização do Olist com `client_id`,
   `redirect_uri`, `response_type=code`, `state` (e `code_challenge` se
   suportado).
4. Dono faz login na conta Olist (se necessário) e aprova o app.
5. Olist redireciona para a rota de callback (Seção 3) com `code`+`state`.

Repetido **duas vezes** (uma por app) e, potencialmente, **uma vez por
ambiente** se cada ambiente usar seu próprio `client_id` (Seção 3 decide
isso). Nenhum uso de API além desta troca inicial de código por token —
consistente com `OLIST_API_CALLS=0` até esta autorização acontecer de
verdade.

## 3. Rota de callback — staging e produção

**Decisão proposta**: um único par de apps (Catálogo/Pedidos) serve os dois
ambientes, com **redirect URIs distintos** registrados no mesmo
"Aplicativo" Olist (a maioria dos provedores OIDC aceita múltiplos
redirect URIs por client — **A CONFIRMAR_OLIST** se o painel permite
cadastrar mais de um por app; se não permitir, a alternativa é um client
por ambiente, mais simples de operar mas duplicando o cadastro no painel).

- Rota única, parametrizada por app:
  `app/api/admin/olist/oauth/callback/route.ts?app=catalogo|pedidos`.
- Redirect URI de staging: `https://staging.persimateriais.com.br/api/admin/olist/oauth/callback`.
- Redirect URI de produção: `https://persimateriais.com.br/api/admin/olist/oauth/callback`.
- **Consistente com a decisão já registrada** (`olist-integration-design.md`
  §14.1/14.3): o app **Pedidos** só precisa ser autorizado em **produção**
  — staging nunca tem essa credencial configurada (export de pedido em
  staging é sempre `dry_run`, sem chamada real). O app **Catálogo** é
  autorizado nos dois ambientes (staging precisa de leitura para
  polling/webhook de teste).
- A rota valida `state` (Seção 2) antes de trocar `code` por token — mesma
  proteção de CSRF já usada no login social, adaptada para uma ação
  administrativa em vez de uma sessão de cliente.
- Depois da troca bem-sucedida, grava o token (Seção 4) e responde com uma
  confirmação simples ao dono — nenhum dado do Olist é exibido além de "app
  X conectado com sucesso".

## 4. Armazenamento do refresh token — criptografado em Postgres

**Reaproveita o padrão de criptografia do PII do checkout**
(`lib/commerce/checkoutPii.ts`), não inventa um novo esquema:

- `createCipheriv("aes-256-gcm", ...)`/`createDecipheriv` (Node
  `node:crypto`, já em uso).
- Mesmo esquema de rotação de chave por `keyId` (`CHECKOUT_PII_KEY_ID`/
  `CHECKOUT_PII_ENCRYPTION_KEYS_JSON`, com fallback
  `CHECKOUT_PII_ENCRYPTION_KEY_<KEYID>`) — variáveis **próprias** para esta
  integração (`OLIST_OAUTH_KEY_ID`/`OLIST_OAUTH_ENCRYPTION_KEYS_JSON`,
  nomes só, sem valor), não as mesmas chaves do PII (segredos de domínios
  diferentes não devem compartilhar material de chave).
- Envelope com `ciphertext`/`iv`/`authTag`/`keyId`/`envelopeVersion`, mesma
  forma de `checkoutPii.ts`, com AAD amarrando o envelope ao `app`
  (`catalogo`/`pedidos`) e ao ambiente — para que um envelope roubado/
  copiado de um contexto não decripte em outro.

Uma tabela nova, forma mínima (não uma migration real, só a especificação):

```
oauth_integration_tokens
  id               uuid primary key default gen_random_uuid()
  provider         text not null            -- 'olist'
  app              text not null            -- 'catalogo' | 'pedidos'
  environment      text not null            -- 'staging' | 'production'
  refresh_ciphertext / iv / auth_tag / key_id / envelope_version  -- como checkoutPii
  access_token_ciphertext / iv / auth_tag    -- token de acesso também cifrado (curto prazo, mas ainda um segredo)
  access_expires_at  timestamptz not null
  refresh_expires_at timestamptz             -- nullable, se o Olist não informar
  last_refreshed_at  timestamptz not null default now()
  version            bigint not null default 1   -- optimistic concurrency no refresh (Seção 5)
  created_at / updated_at

  unique (provider, app, environment)
```

`persi_worker` como único grantee de leitura/escrita (o browser nunca toca
esta tabela; só o worker/rota administrativa server-side).

## 5. Renovação automática — evitando corrida entre processos

**Problema conhecido deste projeto** (`canary-minimum-scope.md` §5.1):
possivelmente mais de um processo Node na Hostinger. Um refresh token
Keycloak tipicamente **rotaciona a cada uso** (o antigo é invalidado ao
trocar por um novo) — se dois processos tentarem renovar ao mesmo tempo
com o mesmo refresh token, um dos dois recebe erro (token já usado) e, pior,
pode sobrescrever o token novo do outro com uma resposta de erro se não for
cuidadoso.

**Desenho**: renovação **lazy** (sob demanda, não um cron dedicado) —
antes de qualquer chamada à API, o cliente verifica `access_expires_at`
com margem de segurança (ex.: renovar se faltar menos de 5 minutos);
se precisar renovar, faz isso dentro de uma transação com `SELECT ... FOR
UPDATE` na linha `(provider, app, environment)` — só um processo consegue
o lock por vez, os demais esperam e, ao continuar, releem a linha (que já
pode ter sido renovada pelo processo que teve o lock, evitando um segundo
refresh desnecessário — o mesmo idioma de "checar de novo depois do lock"
já usado em outras partes deste projeto). `version` incrementa a cada
renovação bem-sucedida, para detectar e logar qualquer tentativa
concorrente que escapou do lock (não deveria acontecer, mas fica auditável
se acontecer).

## 6. Revogação

Dois níveis, nenhum exclusivo do outro:

- **Do lado do site**: apagar a linha de `oauth_integration_tokens`
  correspondente (ação administrativa, auditada) — o próximo uso falha
  fail-closed (Seção 7) até nova autorização (Seção 2).
- **Do lado do Olist**: desativar o "Aplicativo" no painel — não há
  endpoint de revogação documentado publicamente para este realm
  (**A CONFIRMAR_OLIST**); desativar o app é o mecanismo assumido.

## 7. Expiração — fail-closed + alerta

Se a renovação (Seção 5) falhar (refresh token expirado, app revogado,
credencial inválida):

- A chamada que disparou a renovação **falha**, sem tentar a API do Olist
  com um token que não existe mais.
- **Fail-closed só para a confiança no dado do Olist, nunca para a venda**
  — mesmo princípio já usado em toda falha de Olist neste projeto
  (`olist-integration-design.md` §10): webhook/varredura param de
  atualizar `inventory_levels`/`prices`, mas o site continua vendendo com o
  último dado local conhecido; a checagem de carrinho em tempo real
  (`olist-integration-design.md` §5.7) cai para o dado local também.
- **Alerta imediato** (mesmo padrão de `lib/observability/nativeCommerceEvents.ts`,
  nunca com o token em texto) — token expirado/app revogado exige ação do
  dono (repetir a Seção 2), não é um erro transitório que backoff resolve.
- Export de pedido (app Pedidos, produção): se o token expirar, o worker de
  drenagem do outbox não consegue enviar — os pedidos ficam `pending` na
  outbox (82 §5), retomados automaticamente assim que a autorização for
  refeita; nenhum pedido é perdido, só atrasado, e o atraso gera alerta
  (82 §9, backlog/lag).

## Fontes

- [Aplicativos API V3 — Configurações e Utilização](https://ajuda.olist.com/hubs-e-plataformas-via-api/aplicativos-api-v3-configuracoes-e-utilizacao)
- `wordpress-plugin/persi-catalog-engine/src/Api/{Configuration,OlistClient,TokenStore}.php`
  (mesmo provedor OAuth, já em produção neste ecossistema, para o app de
  GTIN — precedente direto, embora em PHP/WordPress, não Next.js/Postgres)
- `lib/commerce/checkoutPii.ts` (padrão de criptografia AES-256-GCM +
  rotação de chave por `keyId` a reaproveitar)
- `lib/account/oauth/{state,google,cookies}.ts` (padrão de `state`/PKCE já
  usado e testado neste projeto para outro fluxo OAuth2)
