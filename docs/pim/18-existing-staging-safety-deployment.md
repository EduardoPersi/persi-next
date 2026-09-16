# Existing Staging Safety Deployment (A3.6-D1.8)

## Continuação R3 (preparação da prova de binding de banco — NENHUM deploy nesta rodada)

**Objetivo único desta rodada**: resolver tecnicamente o gate `STAGING_DATABASE_BINDING=UNKNOWN` (bloqueante desde R2), projetando e implementando **localmente** o menor endpoint de diagnóstico possível — sem commit, sem deploy, sem alteração remota.

### Preflight (drift check)
`HEAD` local confere exatamente com `a1d9cdedc25798880c1b53eb3db776125e06e8e5`. Os 7 arquivos concorrentes não relacionados permanecem preservados intocados. Artefato `a36d18_r2_postdeploy_staging_reconciliation.json` reconfirmado com SHA256 idêntico (`807a17836eaf87bc75504fe5ba618db13c2cf50043d7d2605c3a7e30383aa38e`).

### Auditoria (Seção 2 da tarefa): reaproveitar, não reimplementar
`checkDatabaseBinding()` (D1) já extrai o project ref de forma segura via `postgres.<ref>:` e nunca expõe a URL completa nem a senha. Nenhuma outra rota/mecanismo existente poderia responder isso ao vivo — confirmado por busca no repositório (nenhuma chamada real a `checkDatabaseBinding`/`getRuntimeSafetyStatus` fora de testes e da própria definição). Reaproveitado sem reimplementar parsing.

### O que foi criado

1. **`classifyDatabaseBinding(check: DatabaseBindingCheck): "MATCH"|"WRONG"|"UNKNOWN"`** — adicionada a `lib/pim/publication-runtime-preflight.ts` (função pura, colapsa `{present, projectRef, matchesExpectedStaging}` no contrato de 3 valores; nunca expõe `projectRef`/`present`). Comentário do topo do arquivo atualizado para documentar a exceção estreita desta rodada à regra anterior "não conectar a nenhuma rota".
2. **`app/api/internal/staging/database-binding/route.ts`** (novo, temporário) — rota GET-only:
   - `!isStagingRuntime()` → `404` (aparenta não existir fora de staging), **antes** de qualquer outra verificação;
   - `!isStagingBasicAuthValid(...)` → `401` com `WWW-Authenticate: Basic realm="staging"` (redundante com o gate já existente em `proxy.ts`, mantido aqui para que a rota seja fail-closed mesmo isolada);
   - `classifyDatabaseBinding(checkDatabaseBinding())` dentro de `try/catch`, com fallback para `"UNKNOWN"` em caso de qualquer exceção — nunca lança, nunca assume `MATCH`;
   - resposta de sucesso: **exatamente** `{ "databaseBinding": "MATCH" | "WRONG" | "UNKNOWN" }`, sem cache (`dynamic="force-dynamic"`, `revalidate=0`).
3. **`tests/pimA36D18R3DatabaseBindingDiagnostic.test.mjs`** (novo, 19 testes) — cobre a lógica de classificação (`classifyDatabaseBinding`/`checkDatabaseBinding`, incluindo os casos MATCH/WRONG/UNKNOWN/indeterminado, com fixtures — nunca uma credencial real) e, por meio de asserções estruturais sobre o texto-fonte de `route.ts` (mesma convenção já usada no repositório para arquivos `route.ts`, já que `next/server` com especificador nu não resolve sob o test loader deste projeto — mesma classe de problema já documentado e corrigido em `publication-shadow-runtime.ts`, mas não replicado aqui porque destoaria do estilo de todas as outras rotas), a ordem fail-closed (404 → 401 → UNKNOWN-em-falha) e que nenhum corpo de resposta (`NextResponse.json(...)`) jamais contém `DATABASE_URL`, `projectRef`, `present`, senha ou uma connection string.

### Resultado das validações locais
- `npx tsc --noEmit`: limpo.
- `tests/pimA36D18R3DatabaseBindingDiagnostic.test.mjs`: **19/19 PASS**.
- Testes diretamente relacionados (`pimA36D15DatabaseBindingGuard`, `pimA36D1DatabaseBindingPreflight`, `runtimeSafetyGates`, `stagingAccessGuard`, `paymentAndWooMutationGuards`): **67/67 PASS**, nenhuma regressão.
- `npm run test:pim` completo: **666/666 PASS**.

### Prova de que nenhum segredo pode vazar por este endpoint
- A função `classifyDatabaseBinding` recebe apenas `{present, projectRef, matchesExpectedStaging}` e devolve uma string de 3 valores — não tem acesso a `DATABASE_URL` bruta, então não pode reexpô-la mesmo por erro de programação.
- `checkDatabaseBinding()`/`classifyDatabaseBinding()` são funções puras, sem `fetch`, sem `await`, sem import de cliente de banco — confirmado por teste que varre o texto-fonte do módulo. Zero chamadas de rede/provedor, zero escrita.
- Todo corpo de resposta (`NextResponse.json(...)`) foi extraído e testado individualmente — nenhum contém `DATABASE_URL`, `projectRef`, `present`, `password` ou um literal com forma de connection string.
- Erro interno degrada para `"UNKNOWN"` dentro de um `try/catch` — nunca propaga um stack trace ao cliente.

### Checkpoint (Seção 6 da tarefa) — commit **NÃO realizado nesta rodada**, aguardando revisão do usuário.

### Plano de prova ao vivo (documentação apenas — nenhum passo abaixo autorizado nesta rodada)
1. Checkpoint/commit local dos 3 arquivos desta rodada (excluindo, como sempre, os 7 arquivos concorrentes).
2. Novo archive reprodutível (`git archive` a partir do novo commit).
3. Deploy **exclusivamente** em `staging.persimateriais.com.br` (nunca produção).
4. `GET` autenticado (Basic Auth já configurado) em `/api/internal/staging/database-binding`.
5. Obter `MATCH`, `WRONG` ou `UNKNOWN`.
6. Se `MATCH`: registrar a prova (resposta completa, sem nenhum dado sensível) e atualizar `STAGING_DATABASE_BINDING`.
7. Remover a rota temporária via commit **forward-only** (nunca reescrever histórico).
8. Redeploy de staging sem a rota.
9. Reconfirmar que a rota volta a responder `404`.

Nenhum desses 9 passos foi executado nesta rodada.

### Gates finais desta rodada (preparação apenas)
```
STAGING_DATABASE_BINDING=UNKNOWN
A3_6D18_PASS=NO
SAFE_TO_REQUEST_A3_6_D2_CONTROLLED_SHADOW_ACTIVATION=NO
SAFE_TO_ACTIVATE_SHADOW=NO
SAFE_TO_PUBLISH=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_PRODUCTION=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_DEPLOY_DATABASE_BINDING_DIAGNOSTIC=YES
GIT_COMMIT_PERFORMED=NO
DEPLOY_PERFORMED=NO
HOSTINGER_ACCESSED=NO
```

## Continuação R2 (smoke test pós-deploy real)

O operador confirmou manualmente que o deploy do archive qualificado foi concluído com sucesso em `https://staging.persimateriais.com.br`, que o Basic Auth é solicitado, e que credenciais configuradas funcionam.

**Preflight**: `HEAD` local confere exatamente com o commit implantado (`a1d9cdedc25798880c1b53eb3db776125e06e8e5`). Os 4 artefatos anteriores (D1.6/D1.7/D1.8/R1) tiveram SHA256 reconfirmados sem divergência. Os 7 arquivos concorrentes continuam preservados intocados.

### Verificado ao vivo, diretamente, contra `staging.persimateriais.com.br`

- **Desafio de Basic Auth**: requisição sem `Authorization` → `HTTP 401` com `www-authenticate: Basic realm="staging"` — corresponde exatamente ao literal do código (`proxy.ts::stagingAccessDeniedResponse`). `STAGING_BASIC_AUTH_CHALLENGE_PASS=YES`.
- **Rejeição de credencial inválida**: `Authorization: Basic` com valor não-real/inválido → `HTTP 401` idêntico — confirma que a comparação `timingSafeEqual` de fato valida, não apenas checa presença de header.
- **Identidade de runtime — inferida com alta confiança pelo próprio comportamento observado**: o branch de Basic Auth em `proxy.ts` só executa `if (isStagingRuntime())`. Como o 401 com esse `realm` específico foi observado ao vivo, isso é prova direta, ligada a um trecho de código inequívoco, de que `PERSI_RUNTIME_ENV=staging` está de fato configurado no processo remoto. `STAGING_RUNTIME_IDENTITY_PASS=YES`.

Credenciais válidas **não foram testadas por este agente** (corretamente — nunca deveria possuí-las); o funcionamento foi confirmado manualmente pelo operador.

### Não verificável nesta rodada — **gate crítico bloqueante**

**`STAGING_DATABASE_BINDING=UNKNOWN`**. `checkDatabaseBinding()`/`getRuntimeSafetyStatus()` existem no código mas nunca são chamados de nenhuma rota ou log de startup real (confirmado por busca no código: só aparecem em sua própria definição, testes e documentação) — não existe, por design, nenhum canal seguro para invocá-los contra o processo remoto real sem (a) uma mudança de código nova (fora do escopo desta rodada) ou (b) acesso à API da Hostinger para env/logs (indisponível — `CONNECT_TIMEOUT` novamente nesta rodada, mais 2 tentativas espaçadas além das 11+ anteriores).

Conforme a própria regra explícita desta tarefa (Seção 15): `DATABASE_BINDING != MATCH` → `A3_6D18_R2_PASS=NO`, `HARD STOP` — independente de qualquer outro gate.

### Verificado por identidade de código (não reobservado ao vivo)

Como o commit implantado é byte-a-byte o mesmo já exaustivamente testado offline (D1.6), os seguintes seguem comprovadamente corretos **no código implantado**, mas não foram reexercitados contra o processo ao vivo (sem acesso autenticado, e deliberadamente sem tentar contornar isso): `PIM_PUBLICATION_MODE=off`/zero-trabalho, bloqueio de checkout/pagamentos/mutação Woo/mensageria/ERP/frete, SEO/analytics condicionais.

### Não executado
Leitura de catálogo (Home/listing/PDP), conteúdo de SEO/analytics reais e inspeção de logs — todos exigiam acesso autenticado ou conectividade Hostinger, nenhum dos dois disponível nesta rodada.

### Reconciliação do banco (Seção 11)
`persi-staging` idêntico entre BEFORE e AFTER desta rodada (`pav=3265, av=168, audit=2028, batches=1, pubRows=8, published=0, unpublished=8, reviews=5, decisions=1, conflicts=115`) — zero escrita. Nota: isso confirma o projeto Supabase como um todo, não prova por si só o binding do `DATABASE_URL` do app staging (item ainda `UNKNOWN` acima).

### Diagnóstico do logo (read-only, não corrigido)
`components/Header/Header.tsx::HeaderLogo` usa `next/image` com um asset local cujo nome contém espaço e "ç" (`persi-materiais-eletricos-e-hidraulicos-ferramentas cabeçalho.webp`). **Hipótese principal**: staging é implantado via archive `.tar` (diferente do deploy Git de produção) — nomes de arquivo com espaço/acento são exatamente a classe mais propensa a ser tratada de forma diferente entre codificação de tar e um checkout Git nativo, podendo causar falha de correspondência desse asset específico no staging. Hipótese secundária (menos provável): o otimizador `/_next/image` está excluído do Basic Auth, mas para um asset local o Next.js tipicamente lê do disco diretamente, sem nova requisição HTTP de mesma origem — tornando o bloqueio por Basic Auth menos provável para este caso específico. `LOGO_RENDER_STATUS=UNKNOWN` — não foi possível confirmar sem acesso autenticado. **Não invalida os safety gates** (puramente visual).

## Continuação R1 (retomada após CONNECT_TIMEOUT)

Retomada tentada. **Drift check mínimo (Seção 3 da R1) confirmado sem repetir a qualificação inteira**: branch inalterada, `HEAD`/commit `a1d9cdedc25798880c1b53eb3db776125e06e8e5` ainda existe e é o HEAD atual, archive `persi-next-a1d9cde-node22.tar` com SHA256 idêntico (`ba5698443d72ba7a2644f0ea5ac8c6b9317ee7768fb2b9f1d6cb126648cb7f45`), artefato D1.8 com SHA256 idêntico (`ae806b17809fcc5604f5d228ce3e71d8725948fd0fb80ba5030fc543032f9df6`), os 7 arquivos concorrentes permanecem preservados. `REUSE_PREDEPLOY_QUALIFICATION=YES` — testes/build/tsc **não foram repetidos por formalidade**, conforme instruído.

Recheck read-only do banco de staging: idêntico ao baseline anterior (`pav=3265, av=168, audit=2028, batches=1, pubRows=8, published=0, unpublished=8, reviews=5, decisions=1, conflicts=115`) — zero drift.

**Teste de conectividade com a Hostinger**: 4 tentativas espaçadas nesta rodada, todas `CONNECT_TIMEOUT` — somadas às 7+ tentativas da rodada anterior, totalizando 11+ tentativas sem sucesso. Conforme instrução explícita da própria tarefa ("fazer no máximo tentativas razoáveis e espaçadas... não insistir indefinidamente"), a rodada foi encerrada aqui.

```
HOSTINGER_CONNECTIVITY_PASS=NO
REMOTE_MUTATIONS_PERFORMED=0
```

Nenhum archive foi reconstruído, nenhum código foi alterado, nenhum workaround inseguro foi tentado — exatamente como instruído. O estado para retomada permanece idêntico ao documentado abaixo (seção original D1.8): commit e archive prontos e reutilizáveis, aguardando apenas a restauração da conectividade.


**RESULTADO DESTA RODADA: preparação local completa e verificada; execução remota BLOQUEADA por falha de conectividade dos servidores MCP da Hostinger, não por decisão ou achado de segurança.**

## Bloqueio real

Após a confirmação de acesso real na D1.7, esta rodada tentou reconectar aos servidores `mcp__hostinger-hosting__*` repetidamente (7+ tentativas ao longo de vários minutos) para prosseguir com a configuração de env/deploy. Todas as tentativas retornaram `CONNECT_TIMEOUT`. Isso é uma falha de infraestrutura de conexão desta sessão, não uma ausência de capacidade nem uma negação de acesso — por isso nenhuma etapa remota (Seções 9 em diante da tarefa) foi executada. Nenhum valor foi fabricado ou presumido no lugar de uma resposta real.

## O que FOI completado e verificado nesta rodada (100% local)

### C. Checkpoint de source reprodutível

Worktree tinha 7 arquivos modificados de trabalho concorrente não relacionado (`lib/pim/enrichment-types.ts`, `extractor.ts`, `normalization.ts`, `repository.ts`, `services/catalog/postgres.ts`, `tests/fixtures/pim-enrichment-golden.json`, `tests/pimP5fSourceConflictPolicy.test.mjs`) — todos preservados intactos, **excluídos deliberadamente** do checkpoint via `git add` seletivo (nunca `git add -A`).

```
DEPLOY_SOURCE_COMMIT=a1d9cdedc25798880c1b53eb3db776125e06e8e5
```

Commit **local**, sem push, 81 arquivos (77 novos/modificados da A3.6 + o próprio commit). Confirmado por `git status` pós-commit: os 7 arquivos concorrentes permanecem exatamente como estavam, não tocados.

**Prova de reprodutibilidade real** (não apenas hash): o commit foi extraído via `git archive` para um diretório completamente isolado, `npm ci` executado do zero, e `npm run build` executado com sucesso (exit 0) nesse diretório limpo — provando que o conjunto de arquivos commitado builda corretamente por si só, sem depender de nada do restante do worktree (incluindo os 7 arquivos concorrentes, que estão ausentes dessa árvore por não terem sido commitados).

### Archive de deploy

```
ARCHIVE_FILENAME=persi-next-a1d9cde-node22.tar
ARCHIVE_SHA256=ba5698443d72ba7a2644f0ea5ac8c6b9317ee7768fb2b9f1d6cb126648cb7f45
ARCHIVE_SIZE_BYTES=8161280
SOURCE_COMMIT=a1d9cdedc25798880c1b53eb3db776125e06e8e5
```

Nomenclatura consistente com o padrão histórico já usado nos deploys anteriores de staging (`persi-next-<hash-curto>-node22.tar`). Conteúdo verificado: nenhum `node_modules`, nenhum `.next`, nenhum `.env`/`.env.local` real — apenas `.env.example` (placeholder seguro) e arquivos de código-fonte cujo nome contém "credential" (implementação, não segredo). 1622 arquivos totais, produzidos exclusivamente por `git archive` (que só inclui conteúdo rastreado pelo Git, nunca arquivos ignorados).

### D. Testes/build pré-deploy

`PERSI_OFFLINE_VALIDATION=1 npm run test:pim`: **647/647 PASS**. `npx tsc --noEmit`: limpo. `npm run build` local: sucesso (exit 0). Suíte completa: **1184/1185** (mesma falha pré-existente não relacionada, `tests/instagramFeed.test.mjs`, documentada em rodadas anteriores, não corrigida). Nenhuma falha nova.

### F. DB BEFORE (read-only, persi-staging)

```json
{"pav":3265,"av":168,"audit":2028,"batches":1,"pubRows":8,"published":0,"unpublished":8,"reviews":5,"decisions":1,"conflicts":115}
```

Idêntico ao esperado — nenhuma divergência, nenhuma escrita realizada.

### G. Resolução da fonte Woo para staging

Nenhum backend WordPress/Woo de staging documentado com URL concreta foi encontrado nesta auditoria (buscado em `docs/29`, `docs/33`, `docs/35`, `docs/37` — apenas descrições conceituais, nenhum hostname real). Decisão registrada:

```
STAGING_WOO_SOURCE=PRODUCTION_READ_ONLY
```

Justificativa: todos os caminhos de mutação Woo alcançáveis a partir do staging (carrinho, criação/atualização de pedido) já passam pelos guards centrais da D1.6 (`assertWooMutationAllowed` em `cartRequest`/`restApiWrite`), que lançam **antes** de qualquer fetch real — comprovado por testes com spy (`tests/paymentAndWooMutationGuards.test.mjs`, `called===false`). `WORDPRESS_URL` de staging, quando configurada, deve apontar para `https://loja.persimateriais.com.br` (produção) **estritamente para leitura**, nunca para uma instância própria (que não existe hoje).

## O que NÃO foi executado (bloqueado por conectividade)

- Configuração de nenhuma variável de ambiente em `staging.persimateriais.com.br` (`PERSI_RUNTIME_ENV`, `PIM_PUBLICATION_MODE`, `PIM_SHADOW_SAMPLE_RATE`, `PIM_SHADOW_TELEMETRY_SINK`, `APP_BASE_URL`, `WORDPRESS_URL`, credenciais de Basic Auth).
- Upload do archive.
- Build remoto.
- Restart de qualquer aplicação.
- Todos os smoke tests (acesso, identidade de runtime, binding de banco, shadow-off, catálogo, bloqueio de mutação Woo, checkout, pagamentos, mensageria/ERP/frete, SEO, analytics, logs).
- Captura de DB AFTER (não há "depois" — nada mudou).
- Qualquer verificação de não-impacto em produção pós-deploy (não houve deploy).

**`STAGING_DEPLOY_PERFORMED=NO`. `STAGING_ENV_CHANGED=NO`. `STAGING_DB_WRITES_PERFORMED=0`. `PRODUCTION_CHANGED=NO`. `GIT_PUSH_PERFORMED=NO`.**

## Estado para retomada

Todo o trabalho de preparação está pronto e reutilizável para a próxima tentativa, sem necessidade de refazer nada:

1. `DEPLOY_SOURCE_COMMIT=a1d9cdedc25798880c1b53eb3db776125e06e8e5` (local, HEAD atual da branch de trabalho).
2. Archive pronto em scratchpad: `persi-next-a1d9cde-node22.tar` (SHA256 acima).
3. Lista exata de variáveis a configurar (Seção 9 da tarefa original) já definida.
4. `STAGING_WOO_SOURCE=PRODUCTION_READ_ONLY` já resolvido e justificado.

Assim que a conectividade com os servidores MCP da Hostinger for restabelecida, uma rodada de continuação pode retomar exatamente na Seção 9 (configuração de env) sem repetir preflight, testes, build, checkpoint ou resolução da fonte Woo.
