# Existing Hostinger Staging Runtime — Qualification (A3.6-D1.7)

**Esta rodada é qualificação read-only via a API real da Hostinger. Nenhuma mutação foi feita. Nenhum valor secreto foi lido ou registrado.**

## Evidência humana + confirmação técnica

O usuário reportou, via inspeção manual do painel, duas aplicações Node.js no plano Cloud Professional. Esta rodada confirmou isso de forma independente e técnica: `HOSTINGER_REMOTE_INSPECTION_AVAILABLE=YES` (testado com uma chamada real, não presumido pela memória de sessões anteriores) — `hosting_listWebsitesV1(website_types=["nodejs"])` retornou exatamente:

| Domínio | Tipo | Habilitado | `root_directory` | Criado em |
|---|---|---|---|---|
| `staging.persimateriais.com.br` | nodejs | true | `/home/u861559092/domains/staging.persimateriais.com.br/public_html` | 2026-09-12T20:47:30Z |
| `persimateriais.com.br` | nodejs | true | `/home/u861559092/domains/persimateriais.com.br/public_html` | 2026-07-20T02:24:39Z |

`staging.persimateriais.com.br` já existia desde **antes** desta série de rodadas A3.6 começar — não foi criado por engano nesta sessão.

## Identidade da aplicação staging

- `APPLICATION_EXISTS=YES`
- `APPLICATION_TYPE=nodejs (Next.js, detectado como app_type="next")`
- `APPLICATION_STATUS=enabled, com logs recentes de runtime (última entrada 2026-09-16T02:40:53Z)` — processo ativo
- `DOMAIN=staging.persimateriais.com.br`
- `NODE_VERSION=22` (idêntico ao de produção)
- `BUILD_COMMAND=npm run build` (`build_script:"build"`, `package_manager:"npm"`)
- `START_COMMAND`: gerenciado pelo Phusion Passenger (`PassengerStartupFile server.js`) — não um `npm start` direto
- `WORKING_DIRECTORY=/home/u861559092/domains/staging.persimateriais.com.br/hbuilds/current/nodejs` (confirmado via `.htaccess`, **path completamente distinto** do de produção)

Nenhuma credencial foi lida ou exibida.

## Isolamento de processo — CONFIRMADO ESTRUTURALMENTE

`.htaccess` de cada aplicação (arquivo não-secreto, lido com sucesso em ambas):

```
staging:    PassengerAppRoot /home/u861559092/domains/staging.persimateriais.com.br/hbuilds/current/nodejs
            PassengerRestartDir .../hbuilds/current/nodejs/tmp

production: PassengerAppRoot /home/u861559092/domains/persimateriais.com.br/hbuilds/current/nodejs
            PassengerRestartDir .../hbuilds/current/nodejs/tmp
```

Phusion Passenger gerencia cada `PassengerAppRoot` como um processo completamente separado. Reiniciar um (tocando seu próprio `PassengerRestartDir`) **não tem nenhum efeito** sobre o outro — isolamento de processo e de restart comprovado pela própria arquitetura do Passenger, não inferido.

```
STAGING_PROCESS_ISOLATED=YES
STAGING_RESTART_ISOLATION=YES
STAGING_BUILD_ISOLATION=YES (working directories completamente distintos)
STAGING_START_ISOLATION=YES
```

## Isolamento de variáveis de ambiente — CONFIRMADO

`hosting_listNode_jsEnvironmentVariablesV1` (valores sempre mascarados pela própria API, nunca lidos por este agente):

**Staging (5 variáveis definidas)**: `ADMIN_RATE_LIMIT_HMAC_SECRET`, `ADMIN_SESSION_HMAC_SECRET`, `ADMIN_SUPABASE_PUBLISHABLE_KEY`, `ADMIN_SUPABASE_URL`, `DATABASE_URL`.

**Produção (67 variáveis definidas)**: conjunto completo de pagamentos (Inter, PagBank, MercadoPago), Woo, OAuth (Google/Facebook), Instagram, reCAPTCHA, GTM, endpoints persi-headless (conta/checkout/newsletter/contato/estoque), `CRON_SECRET`, `JWT_AUTH_SECRET_KEY`.

**Zero sobreposição de nomes entre os dois conjuntos.** Isolamento de ambiente confirmado sem ambiguidade: `STAGING_ENV_ISOLATED=YES`.

**Achado operacional relevante**: staging **não tem `WORDPRESS_URL` configurada** hoje — confirmado tanto pela ausência na lista quanto pelos próprios logs de runtime (`"[woocommerce-free-shipping] WORDPRESS_URL não está configurada."`, `INSTAGRAM_FEED_FETCH_FAILED code=MISSING_REQUIRED_ENV`). Isso significa que, **com a configuração atual**, staging não consegue servir catálogo/PDP funcional — não é um bug do código, é uma variável ausente, esperado para uma aplicação criada para outra finalidade (ver Seção "Idade do código" abaixo).

## Binding de banco de dados

`DATABASE_URL` **está presente** na aplicação staging. Por design da própria API da Hostinger (`hosting_listNode_jsEnvironmentVariablesV1`), o valor é **sempre mascarado e nunca pode ser lido de volta** — não existe endpoint que revele o conteúdo real. Portanto:

```
STAGING_DATABASE_BINDING=UNKNOWN (presente, mas alvo não verificável sem expor o segredo)
```

Isso **não é classificado como `WRONG`** (não há evidência de erro) nem como `MATCH` (não há prova de acerto) — é honestamente `UNKNOWN`. Recomendação: antes de qualquer ativação de shadow, confirmar via `getRuntimeSafetyStatus()` (já implementado na D1.6, retorna apenas o project ref não-secreto) chamado a partir do próprio runtime de staging depois do próximo deploy — nunca pedindo ao usuário para colar o valor em texto.

## Identidade de runtime atual

```
PERSI_RUNTIME_ENV_PRESENT=NO
STAGING_RUNTIME_IDENTITY=NOT_STAGING (ausência resolve para "production" pela própria regra de compatibilidade da D1.6)
```

Achado crítico para o próximo deploy: **definir o código dos safety gates sem também definir `PERSI_RUNTIME_ENV=staging` no mesmo passo deixaria os gates completamente inertes** (produção-equivalente, tudo permitido) — os dois precisam ser configurados juntos.

## Proteção de acesso

Nenhuma variável `PERSI_STAGING_BASIC_AUTH_USER`/`PERSI_STAGING_BASIC_AUTH_PASSWORD` configurada. Nenhuma evidência de Cloudflare Access verificada nesta rodada (fora do escopo de acesso desta sessão — nenhuma ferramenta de Cloudflare foi usada).

```
STAGING_ACCESS_PROTECTION=NONE
```

**Risco atual real**: como o código dos safety gates (D1.6) ainda não foi implantado, a aplicação staging hoje está publicamente acessível sem nenhuma proteção — mitigado apenas pelo fato de o catálogo não funcionar (falta `WORDPRESS_URL`) e nenhuma funcionalidade sensível estar de fato operacional na versão atualmente implantada.

## Hostname / DNS

Associação `staging.persimateriais.com.br` → esta aplicação Node.js confirmada ao nível do painel de hospedagem (`hosting_listWebsitesV1`). Verificação de zona DNS/Cloudflare propriamente dita não foi feita nesta rodada (fora do escopo de ferramentas usadas) — não foi necessária para as conclusões acima, já que a própria Hostinger já resolve e serve esse domínio para esta aplicação.

## Git / fonte / mecanismo de deploy — **achado que corrige suposição anterior**

A D1.5 especulou uma futura estratégia de deploy baseada em branch Git (`staging`/`deploy/staging`) alimentando um pipeline Git-conectado, por analogia com o que se esperava de `main` para produção. **Essa suposição não corresponde à realidade descoberta agora — corrigido, não reescrito silenciosamente**:

| | `persimateriais.com.br` (produção) | `staging.persimateriais.com.br` |
|---|---|---|
| Mecanismo de deploy | `source_type: "git"` (278 builds históricos) | `source_type: "archive"` (upload de `.tar`, 15 builds) |
| Última build | 2026-09-11T23:23:28Z | **2026-09-15T23:41:57Z**, arquivo `a34c_deploy.tar` |

**Produção é conectada a um repositório Git real e builda automaticamente a cada push** (confirmado pelo volume — 278 builds). **Staging NUNCA foi Git-conectada** — todo o seu histórico de deploy é via upload manual/scriptado de arquivos `.tar`. Isso é, na verdade, **isolamento de mecanismo de deploy mais forte** do que "ambos em `main`, deploys independentes": os dois nem compartilham o gatilho.

## Idade do código atualmente implantado

Os primeiros 10 uploads de staging usam nomes como `persi-next-e01f477-node22.tar`, `persi-next-7cea904-node22.tar`, `persi-next-e8a2dad-node22.tar`, `persi-next-1b6044f-node22.tar`, `persi-next-6d595bd-node22.tar` — **hashes curtos que correspondem a commits reais deste repositório** (confirmados contra o histórico de commits já observado nesta engenharia). Os dois uploads mais recentes (`a34_deploy.tar`, 2026-09-13T14:21; `a34c_deploy.tar`, 2026-09-15T23:41) usam nomenclatura genérica de tarefa, não hash de commit — sugerindo um processo de deploy diferente usado para uma finalidade específica (provavelmente a validação de checkout em staging documentada em `docs/35-checkout-next-etapa-5-staging.md`), não relacionado à A3.6.

**Nenhum código da A3.6 (publicação PIM, shadow runtime, safety gates da D1.6) pode estar no deploy atual** — todo esse trabalho existiu exclusivamente no worktree local não commitado durante toda esta série de rodadas, e nenhum commit ou push foi feito em nenhum momento.

```
CURRENT_CODE_AGE=BEHIND (alta confiança -- o deploy atual definitivamente não contém nenhum código da A3.6; o commit-base exato de a34c_deploy.tar não pôde ser determinado pelos metadados disponíveis)
```

## Isolamento de logs

`hosting_getNode_jsRuntimeLogsV1` — API dedicada por domínio, testada com sucesso em staging (5 entradas recentes, nenhum segredo, confirmando `started_at`/`last_deployed_at` consistentes com a última build). `STAGING_LOGS_ISOLATED=YES`. Isso viabiliza diretamente uma futura `PIM_SHADOW_TELEMETRY_SINK=console` — os eventos apareceriam neste mesmo canal, isolado de produção.

## Lacuna de deploy dos safety gates (D1.6)

Confirmada. Arquivos que precisam chegar ao staging para os safety gates funcionarem (lista exata, sem alterações concorrentes não relacionadas):

```
lib/runtime/runtime-environment.ts
lib/runtime/runtime-safety-policy.ts
lib/runtime/external-write-guard.ts
lib/runtime/runtime-safety-status.ts
lib/runtime/staging-access-guard.ts
lib/pim/publication-runtime-preflight.ts  (D1/D1.5, pré-requisito do policy)
proxy.ts
app/api/checkout/payment/route.ts
app/layout.tsx
app/robots.ts
components/layout/GoogleTagManager.tsx
services/account/client.ts
services/payments/inter/boleto.ts
services/payments/inter/pix.ts
services/payments/mercadopago/charge.ts
services/payments/pagbank/charge.ts
services/woocommerce/cart.ts
services/woocommerce/contact.ts
services/woocommerce/newsletter.ts
services/woocommerce/restClient.ts
services/woocommerce/stockNotifications.ts
```
E toda a árvore de `lib/pim/publication-*` já existente (pré-requisito transitivo do runtime shadow, não novo nesta rodada).

## Estratégia de deploy futura (corrigida com base na evidência real)

```
fonte local validada (worktree atual, testes/tsc verdes)
  → checkpoint explícito de código (commit LOCAL, sem push -- autorização separada)
  → empacotar em archive .tar (mesmo padrão já usado: persi-next-<hash>-node22.tar)
  → upload via generateUploadURL + startNode_jsBuildV1 (source_type=archive), SOMENTE no domínio staging.persimateriais.com.br
  → configurar env do deploy (Seção "Contrato de primeiro deploy" abaixo) via replaceNode_jsEnvironmentVariablesV1
  → restart automático (a própria chamada de replace já reinicia o processo staging)
  → smoke test
  → qualificar
  → (rodada futura separada) shadow 1%, console sink
```

Nenhum destes passos foi executado nesta rodada.

## Contrato de primeiro deploy (config, não segredo)

| Variável | Valor a definir | Motivo |
|---|---|---|
| `PERSI_RUNTIME_ENV` | `staging` | Sem isso, os safety gates ficam inertes (produção-equivalente) |
| `PIM_PUBLICATION_MODE` | `off` | Explícito por clareza/auditoria, mesmo default sendo equivalente |
| `PIM_SHADOW_SAMPLE_RATE` | `0` | Idem |
| `PIM_SHADOW_TELEMETRY_SINK` | `noop` | Idem — shadow permanece desligado no primeiro deploy |
| `PERSI_STAGING_BASIC_AUTH_USER` | (definir, não neste documento) | Sem isso, acesso continua totalmente aberto |
| `PERSI_STAGING_BASIC_AUTH_PASSWORD` | (definir, não neste documento) | Idem |
| `WORDPRESS_URL` | (staging do WordPress, se existir, ou reavaliar) | Sem isso, catálogo/PDP não funcionam — necessário para o smoke test |
| `APP_BASE_URL` | hostname de staging | Nunca o de produção |
| `DATABASE_URL` | (já presente — apenas CONFIRMAR, não alterar) | Verificar via `getRuntimeSafetyStatus()` pós-deploy, nunca pedindo o valor em texto |

`REMOTE_ENV_CONFIGURATION_REQUIRED=YES` — nenhuma dessas foi configurada nesta rodada. Nenhuma credencial de pagamento (Inter/PagBank/MercadoPago) deve ser adicionada nesta fase.

## Plano de smoke test (futuro, não executado)

PDP abre; catálogo GET funciona (requer `WORDPRESS_URL`); Woo GET funciona; checkout submit bloqueado (`STAGING_EXTERNAL_WRITE_BLOCKED`); Pix/boleto/cartão bloqueados; mutação Woo bloqueada; mensageria bloqueada; GTM de produção ausente; `noindex` presente; Basic Auth/acesso presente; PIM shadow off; zero telemetria de shadow.

## Plano de não-impacto em produção

Após o futuro deploy de staging: processo de produção inalterado (confirmado por natureza — Passenger nunca toca `PassengerAppRoot` de produção ao reiniciar staging), deployment de produção inalterado (mecanismos totalmente distintos: git vs archive), env de produção inalterado (nenhuma chamada de escrita foi ou será feita em produção), resposta pública de produção inalterada (nenhuma mudança de código chega a produção nesta estratégia).

## Testes

Nenhuma alteração de código local foi necessária nesta rodada (rodada de qualificação remota pura). Baseline preservado: `647/647` PIM, `1184/1185` suíte completa (mesma falha pré-existente não relacionada), `tsc --noEmit` limpo — não re-executados nesta rodada por ausência de mudança funcional, conforme instrução explícita de não criar mudança artificial só para gerar teste.

## Bloqueadores restantes

1. `STAGING_DATABASE_BINDING=UNKNOWN` — precisa confirmação pós-deploy via diagnóstico seguro, nunca por leitura direta do valor.
2. `REMOTE_ENV_CONFIGURATION_REQUIRED=YES` — lista exata acima, nada configurado ainda.
3. Verificação de Cloudflare/DNS não realizada nesta rodada (não foi necessária para as conclusões, mas fica registrada como não verificada).
4. Nenhum checkpoint de código local (commit) foi criado — necessário antes de qualquer empacotamento futuro, sob autorização própria e separada.
