# Controlled Published PIM Canary Preparation (A3.7-A)

**Esta rodada é read-only/local. Nenhuma publicação ocorreu. Nenhuma linha do staging foi escrita. Nenhum env foi alterado.**

## Contexto

A3.6 foi formalmente encerrada (`A3_6_PASS=YES`, `A3_6_D2_PASS=YES` — ver `docs/pim/19`). O runtime staging atual (informado pelo operador, não alterado por este agente):

```
PERSI_RUNTIME_ENV=staging
PIM_PUBLICATION_MODE=shadow
PIM_SHADOW_SAMPLE_RATE=1
PIM_SHADOW_TELEMETRY_SINK=console
```

Objetivo desta rodada: preparar (não executar) o primeiro canário de atributos PIM realmente publicados, permitindo uma futura comparação real Woo × PIM (hoje o shadow só produz `OFFICIAL_ONLY` porque `published=0`).

## Auditoria da fundação de publicação (reaproveitada, não recriada)

Confirmado por leitura direta de `lib/pim/publication-service.ts` e `lib/pim/publication-eligibility.ts`:

- **Revalidação de eligibility**: `publishBatch()` reexecuta `evaluatePublicationEligibility()` dentro da própria transação, nunca confiando em uma chamada anterior de `preparePublication()`.
- **Fingerprint determinístico**: `computeMemberFingerprint()` — SHA256 das chaves `productId:attributeId:attributeValueId` ordenadas, independente de ordem de entrada.
- **Rollback somente de estado**: `unpublishBatch()` apenas atualiza `state`/`unpublished_at`/status do batch — nunca deleta linhas, nunca toca Woo.
- **Proteção cross-batch**: `PimPublicationOwnedByAnotherBatchError`, linha travada com `FOR UPDATE` antes do insert — uma linha já publicada nunca é realocada silenciosamente para outro batch.
- **NEEDS_REVIEW fail-closed**: duas camadas — estrutural (`pim_attribute_reviews.status='needs_review'`) e o stopgap `KNOWN_NEEDS_REVIEW_REGISTRY` (`PA013710/comprimento`, `NMEM16/comprimento`, confirmados presentes no código; `NMEM16/material` **não** está nessa lista).
- **Batch órfão/inativo fail-closed**: `PimPublicationBatchNotFoundError`, `PimPublicationBatchAlreadyRolledBackError` (estado terminal, reuso exige novo batch id).
- **Woo permanece imutável**: `publication-service.ts` só toca `pim_publication_batches`/`pim_attribute_publications`/`pim_audit_log` — zero chamada Woo.

Nenhuma nova arquitetura foi criada — a fundação existente é diretamente reutilizável.

## Batch histórico

`63a1969c-8e1f-498f-9eda-1ba7db15e7c1` permanece `rolled_back` (`published=0`, `unpublished=8`), intocado nesta rodada. Uma futura publicação **precisa** usar um novo `batchId` — `publishBatch()` rejeita estruturalmente a reutilização de um batch `rolled_back` (`PimPublicationBatchAlreadyRolledBackError`), não é apenas preferência.

## Universo de candidatos: os 30 slugs reais amostrados em 1%

O artefato `scratchpad/a36d2b_r3_product_sitemap_real_1pct_sample.json` só persistiu os primeiros 10 dos 30 elegíveis. Recuperei a lista completa dos 30 **recomputando deterministicamente** a partir do MESMO sitemap já baixado (hash idêntico ao registrado, `2dbead30...`), reusando a mesma lógica de extração e a mesma função real `isSampled(slug, 1)` — **zero nova requisição de rede, zero mudança de sampling**. Os primeiros 10 batem exatamente com o registro anterior.

Lista completa (30): ver artefato `a37a_controlled_published_pim_canary_preparation.json`, seção `candidate_universe_section5`.

## Cruzamento com PIM — BLOQUEADO

Tentei uma consulta read-only cruzando os 30 slugs com `product_attribute_values`/`attributes`/`attribute_values`/`pim_attribute_reviews`/`pim_conflicts` (usando a `DATABASE_URL` ambiente, já comprovadamente vinculada a `persi-staging`). A consulta foi **bloqueada pelo classificador de segurança do próprio ambiente** ("Production Reads") — o mesmo bloqueio de D1.8-R6 e D2-A. **Não contornei.**

Verifiquei evidência local existente como alternativa: `tests/fixtures/pim-enrichment-golden.json` (fixture sintética de 10 chaves, insuficiente) e toda a documentação `docs/pim/*` (nenhum documento registra SKU ou atributo PIM para nenhum destes 30 slugs — o trabalho histórico do PIM cobriu um conjunto pequeno e curado, diferente, ex. `PA013710`, `NMEM16`, SKU `003359`, `MOD625`). **Nenhuma evidência existente é suficiente.**

Consequência: não sei, hoje, se algum dos 30 produtos amostrados via sitemap já passou pela extração PIM. As Seções 7-10 da tarefa (filtros fail-closed, comparação Woo×PIM, dimensionamento do canário, manifesto) **não puderam ser preenchidas com dados reais** — o schema/procedimento completo foi preparado e fica pronto para uso imediato assim que essa lacuna for fechada.

## Baseline (continuidade, não nova leitura)

```
BASELINE_SOURCE=CONTINUITY_EVIDENCE
pav=3265 av=168 audit=2028 batches=1 pubRows=8 published=0 unpublished=8 reviews=5 decisions=1 conflicts=115
```
Este baseline reflete apenas o batch histórico — não diz nada sobre se os 30 novos produtos têm alguma linha PIM, que é exatamente a lacuna da seção anterior.

## Plano da futura execução (preparado, não executado)

1. Criar NOVO batch (`randomUUID()`, `kind='canary'`) — nunca reutilizar `63a1969c-...`.
2. Usar somente o manifesto aprovado de uma rodada futura.
3. Revalidar eligibility dentro da transação (já como `publishBatch()` funciona).
4. Proteção cross-batch já automática.
5. Verificar fingerprint do manifesto antes de publicar.
6. Publicar somente as associações selecionadas.
7. Reconciliar imediatamente.
8. Nunca tocar Woo/env; manter `PIM_SHADOW_SAMPLE_RATE=1`.
9. Rollback permanece somente-estado (`unpublishBatch()`).

## Plano de observação ao vivo (preparado)

Por produto canário: abrir o PDP uma vez → deve continuar normal → Woo permanece official → procurar `[pim-catalog-shadow]` → exatamente um evento (já provado em D2-D) → `publishedAttributeCount > 0` (primeira prova ao vivo de candidato PIM não-vazio) → classificação deve bater com o manifesto → `errorClass=null`/`shadowStatus=completed`.

## Plano de rollback (preparado)

Nunca alterar Woo/trocar source; despublicar somente o novo batch via `unpublishBatch()` (preserva ledger/auditoria); reconciliar `published=0` para aquele batch; shadow pode continuar ligado ou ser desligado conforme o tipo de falha. Batch histórico `rolled_back` nunca tocado.

## Testes

Conjunto diretamente relacionado (eligibility/exposability/publicação/conflitos/shadow): 127/127 PASS. `npm run test:pim`: 659/659 (inalterado — nenhum código mudou). `tsc --noEmit`: limpo. Nenhum build de rede executado.

## Gate final

```
A37A_CANDIDATE_SET_FOUND=NO
A3_7A_PASS=NO
SAFE_TO_REQUEST_CONTROLLED_CANARY_PUBLICATION=NO
SAFE_TO_PUBLISH=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
```

**Não é um bloqueio de arquitetura/código** — a fundação de publicação, o universo de 30 candidatos reais, o plano de execução futura, o plano de observação e o plano de rollback estão todos prontos e verificados. O único item pendente é uma forma legítima de resolver o estado PIM dos 30 produtos amostrados (leitura read-only atualmente bloqueada pelo classificador do ambiente, ou dados equivalentes fornecidos pelo operador).

Artefatos: `scratchpad/a37a_controlled_published_pim_canary_preparation.json` (SHA256 `aa925d6cfbd7426cc91d7656d4d671691054f9f35e7f034c722720709c18fc91`), `scratchpad/a37a_published_pim_canary_manifest.json` (vazio, schema pronto; SHA256 `f2281653e96f5888773b58d8e00cc29a2f651aa84841b036dbf25f07dc128bb4`).

---

## A3.7-A-R1 — Canal de leitura seguro: reaproveitar o painel admin existente (nenhum endpoint novo)

**Nenhum código foi escrito nesta rodada.** A tarefa pediu para desenhar um endpoint temporário de diagnóstico, mas exigiu explicitamente comparar com alternativas antes de escolher — e uma alternativa mais simples e igualmente (ou mais) segura já existe.

### Alternativas consideradas
**A.** Endpoint temporário protegido (o que a tarefa sugeriu por padrão) — exigiria novo código, novo ciclo de vida completo (implementar → deploy → capturar → remover → provar 404), reintroduzindo exatamente a categoria de risco já aposentada com o diagnóstico de database-binding.
**B.** Script rodado manualmente pelo operador via canal autorizado — nenhum canal desse tipo foi identificado como já disponível.
**C.** Export read-only via SQL editor do Supabase (acesso próprio do operador ao projeto) — viável como *fallback*.
**D. (selecionada)** Reaproveitar o painel admin de PIM **já existente e já implantado**: `/admin/products` (busca por nome/SKU/GTIN) + `/admin/products/[id]` (detalhe: grupos de atributos, valores, `reviewStatus`, conflitos abertos por atributo).

### Por que D vence
- `lib/pim/repository.ts::getPimProduct`/`listPimProducts` — confirmado por inspeção direta: **zero** `INSERT`/`UPDATE`/`DELETE`. O próprio texto da UI já diz "Dados do catálogo são somente leitura nesta ferramenta".
- Protegido por `requirePimAdmin()` (`lib/admin/authorization.ts`): identidade real via Supabase Auth + **MFA obrigatório** + RBAC (`admin_memberships`, permissão `pim.admin.read`) + sessão — uma fronteira de segurança **mais forte** que uma senha Basic Auth compartilhada, e totalmente independente do sistema de Basic Auth/shadow do staging.
- As 4 variáveis de ambiente do admin (`ADMIN_SUPABASE_URL`, `ADMIN_SUPABASE_PUBLISHABLE_KEY`, `ADMIN_SESSION_HMAC_SECRET`, `ADMIN_RATE_LIMIT_HMAC_SECRET`) já estavam **configuradas em staging**, confirmado em D1.7 — o painel já está funcionalmente pronto para uso, sem nenhuma configuração adicional.
- Testes existentes reexecutados (`pimAdminSecurity`, `pimAdminAuthMfa`, `pimAdminSessions`, `pimAdminRateLimit`, `pimAdminAuditAttribution`, `pimP4c1AdminReadonly`): **33/33 PASS**.
- Zero deploy, zero endpoint novo, zero ciclo de remoção a gerenciar depois — a maior vantagem sobre a Alternativa A.

### Mapeamento das propriedades de segurança pedidas na tarefa
`Basic Auth` → equivalente mais forte (Supabase Auth + MFA + RBAC). `DB binding fail-closed` → não se aplica como mecanismo separado (a página lê o mesmo `DATABASE_URL` do processo, já comprovado `MATCH` em D1.8-R4). `Allowlist fechada` → aplicada por disciplina do operador (consultar só os 30 slugs), não por código — é a mesma ferramenta genérica de admin já disponível para qualquer produto. `Read-only` → confirmado por inspeção. `Zero secret exposure` → confirmado. `Zero mutation` → garantido desde que o operador não clique em nenhuma ação (aceitar sugestão, resolver conflito, revisar atributo — todas são Server Actions separadas e explicitamente permissionadas).

### O que a UI do admin NÃO mostra explicitamente (mitigado manualmente, sem código)
`KNOWN_NEEDS_REVIEW_REGISTRY` (os dois casos históricos `PA013710/comprimento` e `NMEM16/comprimento`) não aparece na tela — cruzar manualmente o SKU exibido contra essa lista curta já documentada. `ATTRIBUTE_NOT_SUPPORTED` também não é rotulado — trivial por inspeção, já que só `material`/`conexao`/`comprimento`/`volume` estão no escopo.

### Verificação residual pendente
**Não confirmado**: se a identidade do operador tem uma linha em `admin_memberships` no banco de **staging especificamente** (staging e produção são bancos Postgres separados — login funcionando em produção não garante acesso em staging). Se não existir, criar essa linha seria uma escrita no banco de staging — **não autorizada nesta rodada**, exigindo autorização separada e explícita em uma rodada futura. *Fallback* se o acesso admin não funcionar: Alternativa C (SQL editor do Supabase, acesso próprio do operador).

### Procedimento para o operador
1. Login em `https://staging.persimateriais.com.br/admin`.
2. Para cada um dos 30 slugs, buscar em `/admin/products` por palavras-chave derivadas do slug.
3. Abrir `/admin/products/[id]` do produto encontrado.
4. Anotar: SKU, quais grupos de atributo (`material`/`conexao`/`comprimento`/`volume`) existem, `reviewStatus` de cada valor, `hasOpenConflict` por atributo.
5. Cruzar o SKU contra o registry de NEEDS_REVIEW histórico.
6. Repassar as anotações para uma rodada futura (A3.7-A-R2) montar o manifesto real.

### Testes
33/33 (suíte de admin diretamente relacionada). `npm run test:pim`: 659/659 (inalterado — nenhum código mudou). `tsc --noEmit`: limpo. Nenhum build de rede. `FILES_CHANGED=[]`.

### Gate final
```
A37A_R1_PASS=YES
SAFE_TO_PREPARE_TEMPORARY_STAGING_READ_DIAGNOSTIC_DEPLOY=N/A (superado — nenhum deploy de diagnóstico é necessário)
SAFE_TO_PUBLISH=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
```
Artefato: `scratchpad/a37a_r1_safe_readonly_canary_qualification_channel.json`, SHA256 `de420692dca4248087779707eb69096c09f7ffe6627b416b552325582643be3e`.

---

## A3.7-A-R2 — Auditoria de provisionamento de identidade admin em staging

O operador tentou acessar `https://staging.persimateriais.com.br/admin` (tela carregou normalmente) e recebeu "Não foi possível autenticar com os dados informados." ao tentar logar.

### Fluxo real (por código, não inferido)
```
credenciais → Supabase Auth (signInWithPassword, ADMIN_SUPABASE_URL/ADMIN_SUPABASE_PUBLISHABLE_KEY)
  → MFA (auth.mfa.listFactors — enroll se não houver fator verificado, challenge se houver)
  → verifyAdminIdentity() exige assurance='verified' (AAL2)
  → admin_memberships (Postgres do PRÓPRIO staging, via DATABASE_URL — SELECT apenas; a app não tem INSERT nessa tabela)
  → RBAC (evaluateAdminPolicy)
  → admin_sessions (sessão nativa HMAC, separada do cookie do Supabase)
```

### Duas camadas confirmadas
**A. Identidade (Supabase Auth)** — vive em `auth.users` do projeto apontado por `ADMIN_SUPABASE_URL` (variável distinta de `DATABASE_URL`; se é o MESMO projeto Supabase de produção ou um diferente não pôde ser determinado sem ler o valor, o que não fiz). **B. Membership/RBAC** — tabela `public.admin_memberships`, no MESMO Postgres já usado por toda a engenharia (persi-staging, `DATABASE_URL`, `MATCH` comprovado em D1.8-R4). Confirmado por migration: `GRANT SELECT ON admin_memberships TO persi_app` — **a aplicação não consegue inserir nessa tabela**; provisionar exige acesso Postgres elevado fora do app (SQL editor do Supabase ou conexão direta com privilégio suficiente).

### Mecanismo de bootstrap — NÃO existe para ambiente real
Único padrão de `INSERT INTO admin_memberships` encontrado no repositório: `scripts/database/admin-auth-local-qualification.mjs`, que roda exclusivamente contra um Postgres Docker descartável local, com conexão superuser — não é um runbook para staging/produção. Shape exato confirmado a partir dele: `(identity_provider='supabase_auth', identity_subject=<uuid do Supabase Auth>, role, status='active', created_by)`. As 3 roles (`ADMIN`/`PIM_REVIEWER`/`PIM_APPROVER`) todas incluem `pim.admin.read` — não existe role "somente leitura"; `PIM_APPROVER` é a menos privilegiada (4 permissões) e seria a recomendada para uma futura provisão com esse propósito.

### Por que o login falhou — parcialmente explicado
A mensagem genérica é retornada para QUALQUER exceção não-redirect no fluxo de login — não só credencial inválida, mas também rate limit (`ADMIN_RATE_LIMITED`, 8 tentativas/900s) ou configuração indisponível (`ADMIN_AUTH_UNAVAILABLE`/`ADMIN_RATE_LIMIT_UNAVAILABLE`, menos provável já que as env vars foram confirmadas presentes em D1.7). **Provado**: a falha ocorre no Passo 1 (Supabase Auth), antes de MFA e antes de `admin_memberships`/RBAC serem sequer consultados. **Não provado** (por design — proteção anti-enumeração deliberada, não enfraquecida): se é usuário inexistente ou senha incorreta especificamente.

### Comparação de risco: provisionar admin vs. exportação read-only manual
Ambos os caminhos dependem do **mesmo** acesso Postgres elevado (não existe caminho pelo app para escrever em `admin_memberships`). Provisionar um admin cria uma identidade/capacidade **permanente** (que precisa ser depois revogada/auditada) só para uma consulta pontual de 30 produtos; a exportação read-only via SQL editor do Supabase atinge o objetivo real da A3.7-A com risco estritamente menor (nenhuma identidade nova para gerenciar depois).
```
RECOMMENDED_A37_READ_PATH=SUPABASE_MANUAL_READONLY_EXPORT
```

### Procedimento de provisionamento (preparado, NÃO executado)
5 passos: (1) criar usuário no Supabase Auth do staging — WRITE, senha nova e exclusiva de staging, nunca a de produção; (2) inserir linha em `admin_memberships` via acesso elevado — WRITE, rollback só-de-estado (`status='revoked'`); (3) enrolar MFA (self-service, fluxo já existente do app) — WRITE; (4) verificar login — READ; (5) verificar `/admin/products` — READ. Detalhes completos, com evidência esperada por passo, no artefato.

### Segurança confirmada
Staging-only; nunca reutilizar senha de produção; nenhuma senha é compartilhada com este agente; nenhum segredo impresso; MFA continua obrigatório; RBAC intacto; nenhum bypass criado; Basic Auth externo do staging inalterado (camada completamente separada da autenticação admin).

### Testes
`npm run test:pim`: 659/659 (inalterado). `tsc --noEmit`: limpo. `FILES_CHANGED=[]`.

### Gate final
```
A37A_R2_PASS=YES
SAFE_TO_REQUEST_STAGING_ADMIN_PROVISIONING=YES
SAFE_TO_REQUEST_MANUAL_READONLY_EXPORT=YES
SAFE_TO_EXECUTE_STAGING_WRITE=NO
SAFE_TO_PUBLISH=NO
SAFE_TO_PRODUCTION=NO
```
Artefato: `scratchpad/a37a_r2_staging_admin_identity_provisioning_audit.json`, SHA256 `ff1ffd33794a2e18738c26d153a83206023ff6c255825488f1b2b9c1b7008022`.

---

## A3.7-A-R2B — Plano de provisionamento de membership (auth já funciona)

O operador autenticou com sucesso em staging e recebeu: "Acesso não autorizado — Esta identidade não possui uma membership administrativa ativa."

### Diagnóstico refinado (mais preciso que R2)
Chegar em `/admin/access-denied` (não em `/admin/mfa`) **prova** que a identidade já passou pelo Supabase Auth **e** pelo MFA/AAL2 obrigatório — o fluxo de login sempre força MFA antes de alcançar qualquer página `pim.admin.read`. O bloqueio está comprovadamente na camada de membership/RBAC (`evaluateAdminPolicy`), não em Auth nem em MFA.
```
MFA_COMPLETED=YES (implícito, comprovado por código)
```
Causa mais provável: `MEMBERSHIP_REQUIRED` (nenhuma linha em `admin_memberships` para esta identidade) — consistente com o achado da R2 de que nenhum mecanismo de provisionamento jamais rodou neste staging. `ROLE_INVALID` é descartado (constraint `CHECK` no banco já impede um valor de role inválido). `MEMBERSHIP_INACTIVE` (linha existente mas `status` ≠ `active`) permanece possível, não descartável sem uma leitura.

### Modelo de membership (confirmado por código)
`public.admin_memberships`: `role CHECK IN ('ADMIN','PIM_REVIEWER','PIM_APPROVER')`, `status CHECK IN ('active','inactive','revoked')`, `UNIQUE(identity_provider, identity_subject) WHERE status='active'` (impede duplicata ativa mesmo em race), `RLS + FORCE RLS` sem nenhuma policy definida (nem o owner escreve sem uma conexão com privilégio de bypass) — confirma que escrever exige a conexão elevada do SQL editor do Supabase, nunca `persi_app` (só tem `SELECT`). Sem FK literal para `auth.users` (a ligação é aplicada em código, via `identity_subject` = UUID retornado pelo Supabase Auth). Sem log de auditoria separado para a criação da membership — os próprios campos `created_by`/`created_at`/`revoked_by`/`revoked_at` da linha já são o rastro de auditoria.

### Mecanismo oficial de provisionamento — continua NÃO existindo
Confirmado novamente: nenhuma migration insere `admin_memberships`; o único padrão de `INSERT` no repositório continua sendo o script descartável local/Docker já identificado em R2.

### Role mínima
```
REQUIRED_ROLE=PIM_APPROVER
```
Todas as 3 roles concedem `pim.admin.read` (o único requisito para ver `/admin/products`/`/admin/products/[id]` — todo o conteúdo de dados renderiza independente da role; só os botões de ação são condicionados por permissões adicionais). `PIM_APPROVER` é a menos privilegiada das três. Nota: se o operador, como dono/administrador real da Persi, quiser capacidade administrativa plena e contínua do PIM (não só esta checagem pontual), `ADMIN` seria apropriada para essa necessidade mais ampla — decisão dele, não presumida aqui.

### Plano futuro (preparado, NÃO executado) — mais curto que o da R2
Como Auth e MFA já estão resolvidos para esta identidade, restam apenas: (1) confirmar o project ref de staging; (2) localizar o próprio User UID no Supabase Dashboard (o operador faz isso sozinho, nunca compartilha comigo); (3) checar o estado atual da membership (idempotência: sem linha → prosseguir; linha ativa → NO-OP, reportar; linha inativa/revogada → **parar e pedir decisão humana**, nunca reativar silenciosamente); (4) `INSERT INTO admin_memberships (identity_provider, identity_subject, role, status, created_by) VALUES ('supabase_auth', '<uuid>', 'PIM_APPROVER', 'active', '<referência>')` via SQL editor do Supabase (staging) — nunca uma migration versionada (dado de um ambiente/identidade específicos, não schema); (5) reconciliar (reconferir a linha); (6) operador recarrega `/admin/products`. Nenhum passo de MFA é necessário — já concluído.

### Rollback
`UPDATE admin_memberships SET status='revoked', revoked_at=now(), revoked_by='<ref>' WHERE id=...` — nunca deletar a linha (preserva auditoria), nunca tocar o usuário Auth.

### Testes
33/33 (suíte admin). `npm run test:pim`: 659/659 (inalterado). `tsc --noEmit`: limpo. `FILES_CHANGED=[]`.

### Gate final
```
A37A_R2B_PASS=YES
SAFE_TO_REQUEST_STAGING_ADMIN_MEMBERSHIP_PROVISIONING=YES
SAFE_TO_EXECUTE_STAGING_WRITE=NO
SAFE_TO_PUBLISH=NO
SAFE_TO_PRODUCTION=NO
```
Artefato: `scratchpad/a37a_r2b_admin_membership_provisioning_plan.json`, SHA256 `9a70b8650c953ab1978ae592122852f21748fa4e2d73ce1dee7c47ae955d9bcf`.

---

## A3.7-A-R3 — Causa raiz encontrada: falta uma RLS policy em `admin_memberships`

O operador inseriu a membership corretamente (`role=PIM_APPROVER`, `status=active`, `revoked_at=NULL`, `identity_provider='supabase_auth'`) — confirmado por reconciliação, uma única linha. Mesmo assim, acesso continuou negado após logout/login e em aba anônima nova.

### Causa raiz provada por código
`public.admin_memberships` tem `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, e `persi_app` recebeu `GRANT SELECT` — mas **nenhuma `CREATE POLICY` foi criada para essa tabela em nenhuma migration**. Em contraste, as tabelas irmãs `admin_sessions`, `admin_session_audit` e `admin_rate_limits` (migrations posteriores) **todas** têm uma policy explícita (`for select to persi_app using (true)`). `admin_memberships` nunca recebeu a equivalente.

Pela semântica do Postgres, RLS habilitado+forçado sem nenhuma policy aplicável faz a tabela parecer **vazia** para aquele role em qualquer consulta — sem erro, silenciosamente zero linhas — independente dos dados reais existirem. Isso significa que `findMembership()` (`lib/admin/authorization.ts`) **sempre** retorna `null`, para qualquer identidade, mesmo com uma membership ativa perfeitamente correta.

```
ROOT_CAUSE_PROVEN=YES
ROOT_CAUSE_CLASS=D (RLS/database permission lookup failure)
```

Isso também explica por que a sessão nova/aba anônima não resolveu nada: a membership é sempre consultada ao vivo (sem cache em `admin_sessions`), então o problema não é de sessão — é que a consulta nunca vê a linha, cache ou não.

### O que foi descartado, e por quê
`identity_provider` mismatch — descartado (operador inseriu exatamente `'supabase_auth'`). Role insuficiente — descartado (`PIM_APPROVER` inclui `pim.admin.read`; o role nem chega a ser avaliado, pois a busca já retorna vazio antes disso). Binding de banco diferente — descartado (mesma conexão `DATABASE_URL` já comprovada `MATCH` em D1.8-R4). Cache de sessão — descartado (`admin_sessions` não guarda role/membership). Bug na query em si — descartado (o SQL está correto; o defeito é uma camada abaixo, na configuração de RLS do schema).

### Por que nenhum teste existente pegou isso
Os testes de admin usam `evaluateAdminPolicy()` diretamente com objetos `MembershipCandidate` fake (nunca passam pela RLS real), e o único script que insere de verdade em `admin_memberships` (`admin-auth-local-qualification.mjs`) conecta via CLI local do Supabase — consistente com uma conexão superuser, não `persi_app` — então o caminho exato "ler `admin_memberships` como `persi_app` sob RLS real" nunca foi exercitado ponta a ponta.

### Próxima ação segura (somente leitura, nenhuma escrita)
Na MESMA sessão elevada do SQL Editor que o operador já usou:
```sql
select * from pg_policies where schemaname='public' and tablename='admin_memberships';
```
Esperado se a hipótese estiver certa: **zero linhas**. E:
```sql
set role persi_app; select * from public.admin_memberships; reset role;
```
Esperado: **zero linhas** para `persi_app`, mesmo a linha real existindo. Ambas são leituras puras, zero risco, usando acesso que o operador já tem.

### Correção (não executada nesta rodada)
Se confirmado: criar uma migration nova com `CREATE POLICY admin_memberships_server_select ON public.admin_memberships FOR SELECT TO persi_app USING (true);` (mesmo padrão já usado nas tabelas irmãs) — mudança de código (arquivo de migration) + uma aplicação real no schema de staging (escrita de schema, exige autorização própria e separada). **Nenhum redeploy/Hostinger é necessário** — é puramente um problema de schema Postgres/Supabase, independente do runtime Next.js já implantado.

### Implicação mais ampla (não confirmada)
Como isso é um problema na própria migration (não uma configuração específica de staging), o mesmo defeito provavelmente afeta qualquer outro ambiente onde essa migration rodou sem uma policy de acompanhamento — inclusive, possivelmente, produção. Não verificado (produção não foi acessada nesta rodada); registrado apenas para consciência.

### Testes
33/33 (suíte admin). `npm run test:pim`: 659/659 (inalterado). `tsc --noEmit`: limpo. `FILES_CHANGED=[]`.

### Gate final
```
ROOT_CAUSE_PROVEN=YES
ROOT_CAUSE_CLASS=D
SECOND_MEMBERSHIP_INSERT_NEEDED=NO
HOSTINGER_CHANGE_NEEDED=NO
DB_WRITE_NEEDED=YES (não executado)
CODE_CHANGE_NEEDED=YES (não executado)
```
Artefato: `scratchpad/a37a_r3_admin_membership_live_lookup_root_cause.json`, SHA256 `ed06d726997958fb7cbfe563a2d18a5db0f1c297e93cb2f48d31df3c0379034d`.

---

## A3.7-A-R4 — Correção forward-only implementada e qualificada localmente (não aplicada em staging)

### Confirmação adicional do operador
`pg_policies` para `admin_memberships` retornou **0 linhas** — confirma diretamente a hipótese da R3. `SET ROLE persi_app` falhou com "permission denied" — não refuta a causa raiz, só significa que a sessão do SQL Editor não é membro de `persi_app` (a primeira verificação, `pg_policies`, já bastou sozinha).

### Diligência adicional (para não aceitar a causa raiz sem contestá-la)
Revisei a arquitetura M29 de identidade de runtime (`docs/database/55-71`), que propõe `persi_app_login` + `SET LOCAL ROLE persi_app` para operações de "native commerce". Isso poderia ter mudado minha conclusão se a conexão geral do app (`getDatabase()`/`DATABASE_URL`, usada por `findMembership()`) já usasse esse mecanismo — mas `lib/db/connection.ts` não implementa nenhum `SET ROLE`. Mais importante: a prova real está no **comportamento diferencial observado** — `admin_sessions` (tem policy) funciona hoje (login/MFA/sessão do operador funcionam), `admin_memberships` (sem policy) não — sob a MESMA conexão. Se o app ignorasse RLS (conexão superuser), as duas tabelas se comportariam igual. O fato de se comportarem diferente, exatamente correlacionado com a presença da policy, prova que a conexão respeita RLS e já funciona como `persi_app` para tudo mais — só falta a policy nesta tabela.

Também encontrei por que o teste pgTAP dedicado (`admin_security_foundation.test.sql`) nunca pegou isso: ele testa `has_table_privilege('persi_app', ..., 'SELECT') = true` — isso checa só o GRANT, nunca a visibilidade real de linha sob RLS. Sempre foi `true` (o GRANT sempre existiu), então esse teste nunca poderia detectar a ausência da policy.

### Migration nova (forward-only, nenhuma migration antiga tocada)
`supabase/migrations/20260917120000_admin_membership_server_read_policy.sql`:
```sql
create policy admin_memberships_server_select on public.admin_memberships for select to persi_app using (true);
```
Mais dois blocos `DO` de auto-verificação (mesmo padrão já usado no projeto): confirma que `anon`/`authenticated` continuam com zero privilégio, e que `persi_app` continua sem `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`. `USING (true)` não expõe nada a navegador — o limite de acesso real é o `TO persi_app` (nunca `anon`/`authenticated`); a aplicação já filtra por `identity_provider`/`identity_subject` na própria query.

Confirmado por `git diff`: as migrations originais (`20260910230000`, `20260912030000`, `20260912040000`) permanecem **byte-idênticas**.

### Qualificação local (Docker descartável, Supabase local)
Recriei o banco local do zero (`supabase db reset --local`, aplicando todas as migrations + a nova) e testei com um role `persi_app_login` descartável (senha aleatória local, removido ao final), usando `SET LOCAL ROLE persi_app` — mesmo padrão já estabelecido em `runtime-identity-disposable.mjs`:

Todos os 10 critérios (A-J) confirmados: `persi_app` agora enxerga a membership ativa correta; identidade inexistente retorna zero; linhas inativa/revogada continuam **visíveis** (o filtro de status é corretamente uma responsabilidade da aplicação, não do banco — por design); `anon`/`authenticated`/`PUBLIC` continuam com zero privilégio; `persi_app` continua sem `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` — inclusive uma tentativa real de `INSERT` como `persi_app` foi **rejeitada** com erro `42501`; RLS e FORCE RLS continuam ligados.

Rodei também a suíte pgTAP completa (`supabase test db`): **588/588 testes, 22 arquivos, PASS** — incluindo o teste dedicado de `admin_memberships`.

### Testes
Suíte de admin/RLS/identidade: 50/50. `npm run test:pim`: 659/659 (inalterado — nenhum código TypeScript mudou, só uma migration SQL nova). `tsc --noEmit`: limpo. Instância local descartável encerrada (`supabase stop`) ao final.

### Plano de aplicação futura em staging (preparado, NÃO executado)
Preflight: confirmar project ref exato (`persi-staging`, nunca produção); confirmar que a migration pendente é exatamente essa; confirmar que a membership do operador continua 1/ativa/`PIM_APPROVER` (leitura, sem novo insert); confirmar que `pg_policies` ainda está vazia. Aplicar a migration via o mecanismo normal do projeto. Pós-aplicação: reconciliar `pg_policies`, reconfirmar RLS/FORCE RLS e zero privilégio de navegador, operador relogar e acessar `/admin/products` — **nenhuma nova membership deve ser criada**, a mesma linha já existente passa a ficar visível. Rollback (se necessário): nova migration forward-only com `DROP POLICY`, nunca editar a migration original.

### Gate final
```
ROOT_CAUSE_RLS_POLICY_ABSENCE_CONFIRMED=YES
HISTORICAL_MIGRATIONS_UNCHANGED=YES
FORWARD_ONLY_MIGRATION_CREATED=YES
RLS_REMAINS_ENABLED=YES
FORCE_RLS_REMAINS_ENABLED=YES
PERSI_APP_MEMBERSHIP_SELECT_WORKS_LOCAL=YES
ANON_ACCESS_ADDED=NO
AUTHENTICATED_BROWSER_ACCESS_ADDED=NO
PUBLIC_ACCESS_ADDED=NO
PERSI_APP_MUTATION_ACCESS_ADDED=NO
A37A_R4_PASS=YES
SAFE_TO_REQUEST_CONTROLLED_STAGING_POLICY_APPLY=YES
SAFE_TO_EXECUTE_STAGING_WRITE=NO
SAFE_TO_PUBLISH=NO
SAFE_TO_PRODUCTION=NO
```
Artefato: `scratchpad/a37a_r4_admin_membership_rls_forward_only_remediation.json`, SHA256 `067d04660d549f53ca2a4099bacce32150c217e73e695eb22d62863b8afa497c`. Migration: `supabase/migrations/20260917120000_admin_membership_server_read_policy.sql`, SHA256 `45bffe4e0d3f5e9704024611db518d92e852597930b01ab75ca96c011459f51a`.

---

## A3.7-A-R5 — A policy está lá, mas o acesso continua negado: nova causa raiz (não totalmente provada)

O operador aplicou a migration, reconciliou a policy ao vivo (`admin_memberships_server_select`, `PERMISSIVE`, `roles={persi_app}`, `cmd=SELECT`, `qual=true`) — e mesmo assim, numa sessão **completamente nova** (logout, aba anônima, novo login, novo MFA), o acesso continua negado com a mesma mensagem.

### Não assumi que "policy existe = runtime enxerga"
Cruzei com `admin_sessions`: `resolveAdminSession()`/`establishAdminSession()` (`lib/admin/session.ts`) usam a **mesma** conexão `getDatabase()`/`DATABASE_URL` que `findMembership()`, e fazem INSERT/UPDATE reais em `admin_sessions` — e isso funciona toda vez que o operador loga (prova: ele sempre chega até a checagem de PIM). Isso é evidência forte de que a conexão REALMENTE resolve para privilégios equivalentes a `persi_app` para pelo menos uma tabela irmã, ao vivo, em staging real — não só no meu ambiente local.

Revisitei a arquitetura M29 (`docs/database/55`): confirma que o provisionamento de "quem tem `persi_app`" é **deliberadamente** feito fora do controle de versão ("infrastructure/secret provisioning... audited bootstrap/admin channel") — ou seja, por design, eu NUNCA conseguiria ver esse grant específico no código, em nenhuma rodada.

### Achado de código importante: erro de banco pode parecer "membership ausente"
`requireAdminPermission()` não tem nenhum `try/catch` ao redor da chamada de `findMembership()`. Se essa query lançar qualquer exceção real (erro de permissão, falha de conexão, etc.), ela sobe e cai no catch-all genérico de `requirePimAdmin()`, que só trata especificamente `IDENTITY_REQUIRED` e `MFA_REQUIRED` — qualquer outra coisa vai para a MESMA tela de acesso negado.
```
CAN_DATABASE_ERROR_MASQUERADE_AS_MISSING_MEMBERSHIP=YES
```

### Hipótese líder: identity_subject não bate (não totalmente provada)
`identity_subject` é uma coluna `text` pura — comparação exata, sensível a maiúsculas/espaços, sem nenhuma normalização em código ou na constraint do banco (`btrim(...)<>''` só garante que não é totalmente vazio, não corrige espaços incidentais). É a ÚNICA coluna do INSERT manual que é longa, única e colada de uma UI externa — as outras três (`identity_provider`, `role`, `status`) são literais curtos com baixo risco de erro de digitação, e `role`/`status` ainda são validados por `CHECK` constraint no banco. Duas causas plausíveis: (C1) espaço/caractere incidental ao colar o UUID; (C2) `ADMIN_SUPABASE_URL` (projeto de Auth do staging) pode não ser o mesmo projeto Supabase que `persi-staging` (ref do banco) — ambiguidade sinalizada desde a R2 e nunca resolvida.
```
ROOT_CAUSE_PROVEN=NO
ROOT_CAUSE_CLASS=C (hipótese líder, não totalmente provada)
```
Classe B (erro de banco mascarado) continua uma alternativa real, não descartada. Classe A (role de conexão diferente) enfraquecida pelo cruzamento com `admin_sessions`, mas não eliminada.

### Por que a qualificação local da R4 passou mas staging continua falhando
A qualificação local da R4 criou seu PRÓPRIO role de teste e rodou `SET LOCAL ROLE persi_app` explicitamente — isso prova que a policy funciona SE uma sessão realmente assumir `persi_app`. Não prova (e não podia provar) que a conexão real de staging realmente assume esse papel — esse mecanismo é provisionado fora do repositório, por design.

### Próximo passo mais seguro (design apenas, não implementado)
Antes de qualquer diagnóstico novo: (1) você mesmo reconferir, caractere por caractere, o User UID copiado da aba Authentication do projeto **persi-staging especificamente** contra o que foi inserido; (2) confirmar se `ADMIN_SUPABASE_URL` de staging aponta para esse mesmo projeto Supabase. Se isso não resolver, desenhei (sem implementar) um diagnóstico mínimo temporário que devolveria apenas `{ runtimeDatabaseRole: current_user, membershipLookup: FOUND|NOT_FOUND|ERROR, identitySubjectLength: <int>, errorClass? }` para a identidade JÁ autenticada — nunca o UUID, nunca um segredo — resolvendo de forma definitiva as classes A/B/C1 de uma vez.

### Testes
50/50 (suíte admin/RLS/identidade). `npm run test:pim`: 659/659 (inalterado). `tsc --noEmit`: limpo. `FILES_CHANGED=[]`.

### Gate final
```
ROOT_CAUSE_PROVEN=NO
ROOT_CAUSE_CLASS=C
TEMPORARY_DIAGNOSTIC_NEEDED=YES (design apenas)
SAFE_TO_IMPLEMENT_MINIMAL_STAGING_DIAGNOSTIC=YES
SECOND_MEMBERSHIP_INSERT_NEEDED=NO
SECOND_RLS_POLICY_NEEDED=NO
SAFE_TO_PUBLISH=NO
SAFE_TO_PRODUCTION=NO
```
Artefato: `scratchpad/a37a_r5_post_policy_admin_access_denial_root_cause.json`, SHA256 `b7ec69696a2b84cd3e18aea8b4db9ad7c7cbcc58344e3b64ecbd39fc1c5f569b`.

---

## A3.7-A-R6 — Canal admin funcionando ao vivo; manifesto ainda vazio, mas caminho completo desbloqueado

### Confirmação do canal admin
`STAGING_ADMIN_PRODUCTS_LIVE_PROVEN=YES`. A causa raiz remanescente da R5 era exatamente a hipótese líder já apontada: `identity_subject` inválido (length=19, placeholder literal, não um UUID). O operador resolveu isso de forma independente, criando uma membership nova com o UID real (length=36). A membership inválida antiga foi deixada intocada, conforme instruído — `ADMIN_INVALID_MEMBERSHIP_CLEANUP_PENDING=YES`, registrado como backlog separado.

### Recuperação do universo de 30 candidatos
Recomputado deterministicamente do mesmo sitemap já baixado (hash idêntico ao registrado), zero nova rede: `REAL_SAMPLE_SLUGS_RECOVERED=30`.

### Auditoria do painel admin como canal de qualificação
`/admin/products` busca por nome/SKU/GTIN (não por slug — o slug é buscado pela query mas nunca renderizado). `/admin/products/[id]` mostra `attributeGroups` (nome, cardinalidade, valores com `reviewStatus`), conflitos (`hasOpenConflict`, por atributo). **Não mostra** estado de publicação (`pim_attribute_publications`) nem existe exportação em lote — cada produto exige um acesso individual.

**Ambiguidade importante encontrada na UI**: "Sem revisão" é mostrado tanto para "nunca revisado" quanto para "needs_review real" — a UI não distingue os dois casos visualmente. Tratamento: usar como sinal provisório, cruzar o SKU contra o registry conhecido (`PA013710`/`NMEM16`), e não confiar cegamente nisso para a publicação real futura.

**Correção durante a rodada**: inicialmente concluí que o valor oficial Woo exigiria acesso a produção — errado. O PDP de staging já exibe o valor oficial (é exatamente isso que a resposta oficial mostra), e visitar o próprio staging já é permitido. Então a comparação Woo × PIM É solucionável pelo mesmo canal, sem precisar de nada novo.

### Estratégia eficiente (não pedir 30 consultas)
Como a ordem dos 30 já é fixa e determinística (não escolhida agora), o operador pode percorrer em ordem e **parar assim que encontrar 2-4 produtos utilizáveis** — sem viés, já que a pertença ao bucket de 1% já está definida antes disso.

### Estado da publicação (Requisito H) — por continuidade, não nova leitura
Nenhuma escrita ocorreu em nenhuma rodada desde o baseline conhecido (`published=0`, as 8 linhas existentes pertencem a um batch histórico diferente, não relacionado a estes 30 produtos) — logo nenhum dos 30 candidatos pode estar atualmente publicado.

### Manifesto atualizado
`scratchpad/a37a_published_pim_canary_manifest.json` — schema expandido, lista completa dos 30 slugs com termos de busca sugeridos, **ainda zero associações reais**. Fingerprint de conjunto vazio: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (SHA256 da string vazia, mesma convenção de `computeMemberFingerprint`).

### Passos mínimos para o operador (Seção 20)
Logar no admin → buscar cada candidato na ordem (termos sugeridos fornecidos) → abrir a página do produto → copiar SKU + atributo + valor canônico PIM + status de revisão + flag de conflito → abrir o PDP correspondente e anotar o valor oficial exibido → parar em 2-4 produtos utilizáveis → reportar. Lembrete: valores compostos (`25mm x 1/2"`) são um único valor, nunca separar.

### Testes
115/115 (elegibilidade/read-model/shadow-comparison/conflitos). `npm run test:pim`: 659/659 (inalterado). `tsc --noEmit`: limpo. `FILES_CHANGED=[]`.

### Gate final
```
A37A_R6_PASS=NO
```
Não é mais um bloqueio fundamental como na A3.7-A original — é apenas a espera pelos dados que só o operador pode coletar (canal já funciona, caminho completo já mapeado, nenhum código novo necessário).
```
SAFE_TO_REQUEST_CONTROLLED_CANARY_PUBLICATION=NO
SAFE_TO_PUBLISH=NO
SAFE_TO_PRODUCTION=NO
STAGING_DB_WRITES_PERFORMED=0
```
Artefato: `scratchpad/a37a_r6_live_admin_canary_qualification.json`, SHA256 `f80b1dda5d8747c6e818d4b15fc1a1b72682247c966c8976ca53f251da5c60c6`. Manifesto atualizado: SHA256 `05abc82f8b5a8a99d6008f8c4f0adf70f5f1ec246b750a242f05f8a1e8c12892`.

## Rodada A3.7-A-R6B — Qualificação em lote via leitura direta do banco (não UI)

### Motivação
O operador instruiu explicitamente: "Não faça nenhuma decisão baseado somente na UI. Consulte o estado real do banco." Em vez de 30 inspeções manuais no `/admin/products/[id]`, uma única consulta SQL somente-leitura (`select`, sem qualquer escrita) contra `DATABASE_URL` (persi-staging) resolveu todos os 30 slugs de uma vez.

### Nota sobre o canal de leitura
Pela primeira vez nesta sessão inteira, uma consulta direta ao `DATABASE_URL` via ferramentas locais **não foi bloqueada** pelo classificador de "Production Reads" do modo automático — funcionou de primeira. Isso não deve ser assumido como permanente; cada rodada futura deve reverificar, não presumir.

### Resultado da qualificação em lote (todos os 30, `evaluatePublicationEligibility()` real, sem UI)
`REAL_SAMPLE_PRODUCTS_RESOLVED=30/30`. Cruzamento de sanidade: `bota-de-seguranca-camurca-marrom-no41-dellani` resolveu para SKU `311C-41-MR`, exatamente o SKU que o próprio operador já havia reportado manualmente para o candidato #7 — confirma a consulta.

Nenhuma das 30 linhas tinha `reviewStatus` diferente de nulo (nenhum registro de revisão existe — não é "needs_review", é ausência de revisão), nenhuma tinha conflito aberto, nenhuma tinha `publicationState`/`batchId` preenchido. Nenhum SKU da amostra bate com o `KNOWN_NEEDS_REVIEW_REGISTRY` (`PA013710`, `NMEM16`). Verificação adicional (somente leitura) das `description` dos 10 produtos com atributo `material`: nenhuma bate com `TEMPLATE_PLACEHOLDER_PATTERN` — `KNOWN_FALSE_POSITIVE` não se aplica a nenhuma.

**ELIGIBLE_NOW = 13 produtos / 18 associações.** **BLOCKED_ONLY_BY_REVIEW = 0.** **BLOCKED = 17 produtos**, todos por `ASSOCIATION_NOT_FOUND` (zero associação em `material`/`conexao`/`comprimento`/`volume` — só atributos não suportados como cor/tamanho, ou nenhum atributo). Nenhum produto da amostra tem associação em `volume` — diversidade máxima possível na amostra é 3 tipos (material, conexao, comprimento).

### Seleção (Fase 5)
Ranking por (1) sem conflito, (2) não publicado, (3) mais associações, (4) diversidade, (5) ordem determinística: `tubo-pvc-branco-roscavel-1-2-krona-6m` lidera com 3 associações (comprimento=6m, conexao=Roscável, material=PVC — cobre sozinho os 3 tipos existentes na amostra). Selecionados 2 produtos / 5 associações (dentro do intervalo pedido de 2-6): `tubo-pvc-branco-roscavel-1-2-krona-6m` + `forro-pvc-em-regua-frisado-branco-7mm-x-20cm-x-5m` (comprimento=5m, material=PVC). Fingerprint real (`computeMemberFingerprint`, IDs reais de atributo/valor resolvidos por leitura adicional): `32a0b3448a289abf2b290e8182606505c9fac31a7d4937f9ae3c6fb51a3b55bf`.

### Classificação esperada (Fase 6)
`OFFICIAL_VALUE_REQUIRES_OPERATOR_PDP_READ=YES` para as 5 associações selecionadas — esta rodada foi escopada como somente-banco, sem leitura de PDP. URLs exatas fornecidas ao operador:
- `https://staging.persimateriais.com.br/tubo-pvc-branco-roscavel-1-2-krona-6m` (comprimento, conexao, material)
- `https://staging.persimateriais.com.br/forro-pvc-em-regua-frisado-branco-7mm-x-20cm-x-5m` (comprimento, material)

### Verificação de zero escrita (Fase 7)
`pim_publication_batches=1`, `pim_attribute_publications`: `unpublished=8/published=0` — idêntico ao baseline de continuidade. `pim_attribute_reviews=5` — idêntico. `pim_conflicts` abertos: `113` vs baseline `115` (pequena redução, consistente com atividade legítima e independente de revisão pelo operador entre rodadas — uma escrita desta sessão não poderia ter *reduzido* uma contagem). `STAGING_DB_WRITES_PERFORMED=0`.

### Testes (Fase 8)
`npm run test:pim`: 659/659. `tsc --noEmit`: limpo. `FILES_CHANGED=[]` (nenhum arquivo de código alterado nesta rodada).

### Gate final
```
A37A_R6B_PASS=YES
SAFE_TO_REQUEST_CONTROLLED_CANARY_PUBLICATION=YES
```
Os 2 produtos/5 associações selecionados estão qualificados e prontos para a próxima etapa (leitura do PDP pelo operador para obter o valor oficial e permitir a comparação shadow real). Nenhuma publicação foi solicitada ou executada nesta rodada.
```
SAFE_TO_PUBLISH=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
AUTH_CHANGED=NO
MFA_CHANGED=NO
MEMBERSHIP_CHANGED=NO
RLS_CHANGED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r6b_fast_readonly_canary_candidate_qualification.json`, SHA256 `f78ec0795c8f8c4c0cf4392245093a092a36f725cb149a47ba3681a3c7c8af93`.

## Rodada A3.7-A-R6C — Reconciliação com evidência humana do PDP e classificação real

### Motivação
O operador leu manualmente os 2 PDPs públicos de staging selecionados na R6B e reportou a Ficha Técnica oficial exibida. Esta rodada usa essa evidência (não uma nova leitura de produção) para determinar a classificação esperada real das 5 associações, via a implementação exata de `compareOfficialWithPimCandidate()`.

### Auditoria da semântica real (Fase 1)
`lib/pim/publication-shadow-comparison.ts` agrupa os atributos de ambos os lados por `code` (o code do candidato PIM é `public.attributes.code`, via `publication-candidate.ts`/`publication-read-model.ts`). Quando o candidato tem o código mas o lado oficial não tem (`!officialByCode.has(code)`), a classificação é exatamente `PIM_ONLY` — **não** `VALUE_DIFFERENCE`, **não** `MATCH`. Confirmado literalmente pelo próprio teste do projeto (`tests/pimA36AShadowComparison.test.mjs`, "matrix 2: PIM has an attribute official does not => PIM_ONLY"), que também assevera `safeForFutureCanary=false` nesse caso exato ("nothing to match against").

Achado adicional: `isPublicationExposable()` só inclui uma linha no candidato quando `publicationState='published'` e o batch está `active`. Como as 5 associações selecionadas ainda não foram publicadas, a classificação abaixo é uma **projeção determinística** do que ocorreria após uma publicação futura — exatamente o propósito deste canário.

### Classificação das 5 associações (Fase 2)
Evidência humana: nenhum dos dois PDPs exibe comprimento/conexao/material na Ficha Técnica oficial (0117 mostra só Cor/Marca; PVCB5M mostra só Marca/Cor). Resultado: **todas as 5 associações classificam como `PIM_ONLY`** (`OFFICIAL_ATTRIBUTE_PRESENT=false`, `OFFICIAL_VALUE=null` para todas).

| SKU | ATTRIBUTE | PIM_VALUE | OFFICIAL_ATTRIBUTE_PRESENT | OFFICIAL_VALUE | EXPECTED_CLASSIFICATION |
|---|---|---|---|---|---|
| 0117 | comprimento | 6m | false | null | PIM_ONLY |
| 0117 | conexao | Roscável | false | null | PIM_ONLY |
| 0117 | material | PVC | false | null | PIM_ONLY |
| PVCB5M | comprimento | 5m | false | null | PIM_ONLY |
| PVCB5M | material | PVC | false | null | PIM_ONLY |

### Validade do canário (Fase 3) — achado importante
Revalidado sem escrita: 2 produtos, 5 associações, todas publication-eligible, nenhuma needs_review, nenhum conflito aberto, nenhuma publicada — idêntico à R6B. O canário **é mecanicamente válido** para provar publicação → leitura pelo read model → shadow comparison → ausência de alteração da resposta oficial → rollback (as 5 etapas pedidas). **Porém**, como todas as 5 associações são `PIM_ONLY`, o próprio `safeForFutureCanary` do comparador seria `false` para os dois produtos — "nada para comparar contra", por definição do próprio código. Este canário prova o mecanismo ponta a ponta corretamente, mas **não produzirá uma confirmação de MATCH real**, porque o catálogo oficial atualmente não carrega nenhum dado de comprimento/conexão/material para nenhum dos dois produtos. Isto é reportado como achado, não como falha — nenhuma substituição de produto foi feita (fora de escopo nesta rodada).

### Manifesto final (Fase 4)
Ordenação determinística SKU→atributo. Fingerprint idêntico ao da R6B (membership inalterado): `32a0b3448a289abf2b290e8182606505c9fac31a7d4937f9ae3c6fb51a3b55bf`. Somente qualificação — nenhuma chamada a `preparePublication()`/`publishBatch()`.

### Invariantes (Fase 5) e testes (Fase 6)
`pim_publication_batches=1`, `unpublished=8/published=0`, `reviews=5`, `conflitos abertos=113` — idêntico ao estado final da R6B. `STAGING_DB_WRITES_PERFORMED=0`. `PERSI_OFFLINE_VALIDATION=1 npm run test:pim`: 659/659. `tsc --noEmit`: limpo.

### Gate final
```
A37A_R6C_PASS=YES
SAFE_TO_REQUEST_CONTROLLED_CANARY_PUBLICATION=YES
```
Válido para a prova mecânica do pipeline; o operador deve estar ciente de que o resultado esperado é `PIM_ONLY` em todas as 5 associações, não `MATCH`.
```
SAFE_TO_PUBLISH=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r6c_final_canary_manifest_qualification.json`, SHA256 `4b91b793124321256ddf484dca04ef813d474c15348a838b289ffbb8c2cc649e`.

## Rodada A3.7-A-R7 — Busca por canário comparável entre os 13 ELIGIBLE_NOW (achado arquitetural)

### Motivação
Antes de pedir qualquer publicação, verificar se algum dos outros 11 produtos ELIGIBLE_NOW (além de 0117/PVCB5M) permitiria uma classificação `MATCH`/`VALUE_DIFFERENCE` real, em vez de `PIM_ONLY`.

### Achado principal (Fase 2) — gap estrutural de namespace de código
Auditando `services/catalog/woocommerce.ts` (`mapWooProductToCatalog`, a ÚNICA função real que produz o `CatalogProduct` oficial usado pelo shadow), o código do atributo oficial é `attribute.taxonomy ?? attribute.name`. Para qualquer atributo GLOBAL do WooCommerce (o tipo usado para specs reutilizáveis como Material/Comprimento/Conexão), `taxonomy` segue a convenção nativa do WooCommerce com prefixo `pa_` — confirmado no próprio código deste projeto (`services/woocommerce/search.ts:108-110`: `attribute.slug || 'pa_' + slugify(attribute.name)`; `services/woocommerce/filters.ts:70`: comparação literal com `'pa_marca'`).

O código do lado PIM/candidato é sempre `public.attributes.code` — vocabulário minúsculo, sem prefixo, em português, restrito por CHECK (`^[a-z][a-z0-9_]*$`): `material`, `conexao`, `comprimento`, `volume`. `compareOfficialWithPimCandidate()` casa atributos por **igualdade exata de string** do campo `code` (`groupByCode`), sem normalização de código (só o `value` é normalizado). Logo: `"pa_material" !== "material"` — **nunca** haverá match de código para um atributo global do Woo, não importa qual dos 13 produtos seja escolhido. Só uma coincidência (um atributo local/custom do Woo nomeado literalmente `material` em minúsculo) permitiria um match real — e a convenção de nomenclatura do WordPress/Woo tende a capitalizar (`"Material"`), o que também não bateria (comparação sensível a maiúsculas).

Achado secundário: os próprios testes do comparador (`tests/pimA36AShadowComparison.test.mjs`) usam fixtures idealizadas com códigos já alinhados (`{code:"material",...}` também no lado oficial) — isso testa corretamente o algoritmo de comparação isoladamente, mas nunca exercita o caminho real de taxonomy do Woo, então nenhum teste existente pegaria esse gap. Um terceiro vocabulário (inglês, `lib/pim/extractor.ts`'s `ATTRIBUTE_ALIASES`) existe só para `pim_conflicts.attribute_key`, também não reconciliado com os outros dois. Nenhuma tabela mapeia `attributes.code` para uma taxonomy do Woo (`external_mappings` não tem `entity_type='attribute'`), e nenhum registro histórico do `attribute.taxonomy`/`attribute.name` real do Woo por produto foi encontrado persistido em lugar algum consultável.

**Conclusão**: isto é um gap arquitetural, não um problema de dados de um produto específico. Buscar entre os 13 elegíveis não resolve isso sozinho — só pode confirmar mais casos de `PIM_ONLY` (quando o conceito está ausente da Ficha Técnica oficial) ou, no caso raro de um atributo custom em minúsculo, revelar um candidato que ainda precisaria de uma verificação técnica adicional (fora de escopo nesta rodada, somente-leitura, sem alteração de código).

### Classificação das 18 associações (Fase 3)
`PIM_ONLY_CONFIRMED=5` (as mesmas 5 de 0117/PVCB5M, por evidência humana de PDP já registrada na R6C — ausência confirmada do conceito, independente de qualquer detalhe de código). `OPERATOR_PDP_READ_REQUIRED=13` (as 13 associações restantes, dos outros 11 produtos — nenhuma evidência humana existe ainda). `COMPARABLE_EVIDENCE_AVAILABLE=0`. `BLOCKED=0`.

### Resultado (Fase 4/6)
`MATCH_CANDIDATES=0`, `VALUE_DIFFERENCE_CANDIDATES=0`, `COMPARABLE_CANARY_FOUND=NO`. `R6C_PIM_ONLY_FALLBACK_REMAINS_VALID=YES`, `R6C_PIM_ONLY_FALLBACK_RECOMMENDED_FOR_MECHANICAL_PROOF=YES`. O manifesto da R6C não foi alterado nem substituído.

### 3 verificações opcionais sugeridas ao operador (Fase 5)
```
OPERATOR_CHECK: SKU=RP2M
STAGING_URL=https://staging.persimateriais.com.br/regua-aluminio-pedreiro-para-reboco-e-nivelamento-2m
LOOK_FOR=[comprimento, material]

OPERATOR_CHECK: SKU=05646
STAGING_URL=https://staging.persimateriais.com.br/terminal-compressao-25-mm-m6-5-pcs
LOOK_FOR=[conexao, material]

OPERATOR_CHECK: SKU=04220
STAGING_URL=https://staging.persimateriais.com.br/abracadeira-condulete-top-pvc-cinza-3-4-para-fixacao-de-eletroduto-tigre
LOOK_FOR=[material]
```
Somente a Ficha Técnica, não a página inteira. Importante: uma resposta "aparece" não prova por si só um `MATCH`/`VALUE_DIFFERENCE` real (por causa do gap de namespace acima) — só uma resposta "não aparece" confirma definitivamente mais um `PIM_ONLY`.

### Invariantes e testes
`pim_publication_batches=1`, `unpublished=8/published=0`, `reviews=5`, `conflitos abertos=113` — idêntico às rodadas anteriores. `STAGING_DB_WRITES_PERFORMED=0`. `PERSI_OFFLINE_VALIDATION=1 npm run test:pim`: 659/659. `tsc --noEmit`: limpo. `FILES_CHANGED=[]`.

### Gate final
```
A37A_R7_PASS=YES
SAFE_TO_REQUEST_CONTROLLED_CANARY_PUBLICATION=YES
```
Válido apenas para a prova mecânica (fallback R6C, `PIM_ONLY`). Nenhum canário `MATCH`/`VALUE_DIFFERENCE` foi encontrado nem pode ser garantido pela arquitetura atual sem uma correção de código futura (fora de escopo aqui).
```
SAFE_TO_PUBLISH=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r7_readonly_comparable_canary_search.json`, SHA256 `22a23244a063300539b137b999505d22a3eb70ce7f16111ee6228b3a5fdf2b5f`.

## Rodada A3.7-A-R8 — Reconciliação de vocabulário de atributo oficial/PIM (correção de código local)

### Motivação
Corrigir localmente o gap arquitetural provado na R7: `material != pa_material`, o que tornava `MATCH`/`VALUE_DIFFERENCE` inatingível para os 4 atributos suportados, independente do produto.

### Prova da causa raiz (Fase 1)
Confirmado com `ROOT_CAUSE_PROVEN=YES`. Código oficial vem de `services/catalog/woocommerce.ts:9` (`attribute.taxonomy ?? attribute.name`); código PIM vem de `public.attributes.code` via `lib/pim/publication-candidate.ts`/`publication-read-model.ts`. A comparação (`lib/pim/publication-shadow-comparison.ts`'s `groupByCode`) é por igualdade exata de string, sem normalização de código, sem case-folding. Atributos globais do Woo sempre usam o prefixo `pa_` (confirmado no próprio código de ingestão, `services/woocommerce/search.ts:108-110` e `services/woocommerce/filters.ts:70`). Atributos locais/custom (`taxonomy=null`) caem no `attribute.name` bruto — nunca canonicalizado, por design.

### Correção implementada (Fases 2-4)
Nova função pura `canonicalizeOfficialAttributeCode()` em `lib/pim/publication-shadow-comparison.ts`: allowlist explícita e fechada (`pa_material→material`, `pa_conexao→conexao`, `pa_comprimento→comprimento`, `pa_volume→volume`), com guarda auto-verificável em tempo de import garantindo que o codomínio é sempre um subconjunto de `SUPPORTED_ATTRIBUTE_CODES`. `groupByCode()` ganhou um parâmetro opcional de canonicalização, aplicado **somente** ao lado oficial dentro de `compareOfficialWithPimCandidate()` — o lado PIM/candidato nunca é tocado. Nenhuma mudança no mapper Woo, nenhuma mudança de banco. Um código oficial fora da allowlist (`pa_marca`, `pa_cor`, um nome local como `"Material do produto"`) passa inalterado — fail-closed.

**Achado bônus**: o bloqueio `KNOWN_NEEDS_REVIEW_REGISTRY` também estava estruturalmente inatingível via um código oficial real `pa_`-prefixado, pela mesma causa raiz — a correção conserta isso de brinde, sem tocar em `publication-needs-review-registry.ts`.

### Testes (Fase 5) e verificação de colisão (Fase 6)
19 novos testes em `tests/pimA37AR8AttributeVocabularyReconciliation.test.mjs`, cobrindo os 14 casos pedidos + replay dos 3 cenários R6C + prova de colisão. `CANONICALIZATION_COLLISIONS=0`: mapeamento 4→4 bijetivo, restrito a `SUPPORTED_ATTRIBUTE_CODES`; outros códigos PIM existentes (`cor`, `bitola`, etc.) nunca podem alcançar um candidato publicado (`publishBatch()` rejeita como `ATTRIBUTE_NOT_SUPPORTED`), logo são irrelevantes ao risco de colisão.

### Regressão (Fase 7) e replay local (Fase 8)
`PERSI_OFFLINE_VALIDATION=1 npm run test:pim`: **678/678** (659 pré-existentes inalterados + 19 novos). `tsc --noEmit`: limpo. Replay local dos 3 cenários da R6C confirma: Caso A (ausência real) continua `PIM_ONLY`; Caso B (`pa_material=PVC` vs `material=PVC`) agora produz `MATCH`; Caso C (`pa_material=Aço` vs `material=PVC`) produz `VALUE_DIFFERENCE` — a correção nunca fabrica concordância nem esconde divergência.

### Arquivos alterados
`lib/pim/publication-shadow-comparison.ts` (+72/-4 linhas). Novo: `tests/pimA37AR8AttributeVocabularyReconciliation.test.mjs` (19 testes). Nenhum outro arquivo do repositório tocado. Zero acesso a staging remoto ou banco nesta rodada (proibido explicitamente).

### Gate final
```
A37A_R8_PASS=YES
CODE_CHANGE_NEEDED=YES (aplicado localmente)
DB_CHANGE_NEEDED=NO
MIGRATION_NEEDED=NO
STAGING_WRITE_NEEDED=NO
SAFE_TO_PREPARE_R8_CHECKPOINT=YES
SAFE_TO_DEPLOY_R8_TO_STAGING=NO
```
```
SAFE_TO_PUBLISH=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
STAGING_REMOTE_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r8_attribute_vocabulary_reconciliation.json`, SHA256 `6c5a92dadec811fe71d6be75c78985e1b05eae564c2215ddd10550337360819e`.

## Rodada A3.7-A-R8C — Checkpoint Git seletivo e pacote de deploy futuro

### Motivação
Transformar a correção local da R8 em um commit Git seletivo, auditável, e preparar (sem executar) um pacote para futuro deploy manual no Hostinger staging.

### Preflight e separação de arquivos (Fase 1)
`HEAD_BEFORE=3aa3a9bb26e9da263c63213e842e0f131fdfb163` (inalterado desde o início do engagement). `R8_FILES_IDENTIFIED`: exatamente `lib/pim/publication-shadow-comparison.ts` e `tests/pimA37AR8AttributeVocabularyReconciliation.test.mjs`. `UNRELATED_DIRTY_FILES=11` (os 9 arquivos modificados concorrentes de sempre + `docs/pim/20` e a migration RLS, ambos untracked). **Decisão explícita**: `docs/pim/20-controlled-published-pim-canary.md` foi **excluído** deste commit — é um documento cumulativo cross-round (contém A3.7-A original até R8), não um artefato exclusivo da R8; permanece em disco, untracked, disponível para um commit de documentação dedicado no futuro, se desejado.

### Auditoria semântica final (Fase 2)
Reconfirmados no diff real, todos os 12 itens: allowlist exata (só os 4 pares), sem strip genérico de `pa_`, atributos desconhecidos fail-closed, nomes locais Woo não convertidos heuristicamente, valores intocados, compound values opacos, candidate/oficial não mutados, eligibility não relaxada, source authority inalterada, nenhuma chamada de rede nova, nenhuma mudança de DB/schema/migration/env. `R8_SEMANTIC_AUDIT_PASS=YES`.

### Testes, staging seletivo e commit (Fases 3-5)
`PERSI_OFFLINE_VALIDATION=1 npm run test:pim`: 678/678. `tsc --noEmit`: limpo. `git add` seletivo dos 2 arquivos (nunca `git add .`/`-A`). `UNRELATED_STAGED_FILES=0`. Commit local único: **`e11d890743052b01f4fb59b82491154aca30483e`** — "fix(pim): reconcile Woo attribute taxonomy codes" (2 arquivos, +299/-4). Sem push. Estado pós-commit confirmado: os 11 arquivos concorrentes/não relacionados permanecem exatamente como estavam.

### Archive reproduzível e validação (Fases 6-7)
`git archive --format=tar` do commit exato (nunca do worktree sujo): `persi-next-e11d890-a37a-r8-node22.tar`, SHA256 `68b2206a5fe77564efe15e614af988b07d6f1b84706b1745d563818540d35eec`, 1626 arquivos, confirmado sem `.env`/`node_modules`/`.next`/secrets.

Extraído em diretório isolado + `npm ci`: `test:pim` deu 630 testes/552 pass/**78 fail**. Investigação de causa raiz (comparando 4 ambientes: working tree, worktree no commit R8, worktree no baseline pré-R8, e o tar extraído) provou que **as 78 falhas têm zero relação com a R8**: 73 vêm de um gap pré-existente e já conhecido entre o `normalization.ts`/`extractor.ts` commitados (HEAD) e o WIP local não commitado desses mesmos arquivos (idêntico nas duas comparações commit-vs-baseline, antes e depois da R8); as outras 5 vêm de testes que chamam `git grep` internamente e só falham porque um tar não tem `.git` — propriedade esperada de qualquer artefato de deploy limpo. As 19 novas associações de teste da R8 passam 100% em todas as 4 configurações. **Conclusão de segurança de deploy**: como o WIP não commitado nunca foi implantado em staging, este archive representa exatamente a base atual de staging (`3aa3a9b`) + a correção R8, sem nenhuma regressão real.

`tsc --noEmit` no archive: limpo. **Build offline real executado** (não apenas pulado) via o mecanismo já existente do projeto `npm run build:offline` (`scripts/offline-validation-runner.mjs`): build completo do Next.js, com guarda de rede ativa — 108 tentativas WooCommerce e 1 do Instagram corretamente bloqueadas, `actualExternalRequests=0`. Build passou.

### Plano do deploy futuro, sem executar (Fase 8)
Nenhuma variável foi alterada. O deploy futuro deve preservar, além de todas as demais já existentes: `PERSI_RUNTIME_ENV=staging`, `PIM_PUBLICATION_MODE=off`, `PIM_SHADOW_SAMPLE_RATE=0`, `PIM_SHADOW_TELEMETRY_SINK=noop`. Gate pós-deploy antes de reativar o shadow: (1) staging protegido continua funcionando, (2) PDP canário abre normalmente, (3) nenhum novo `[pim-catalog-shadow]`, (4) resposta oficial sem regressão, (5) só então solicitar autorização separada para reativar o shadow.

### Gate final
```
A37A_R8C_PASS=YES
GIT_COMMIT_PERFORMED=YES
R8_COMMIT_SHA=e11d890743052b01f4fb59b82491154aca30483e
ARCHIVE_CREATED=YES
SAFE_TO_REQUEST_MANUAL_STAGING_DEPLOY_WITH_SHADOW_OFF=YES
```
```
SAFE_TO_ACTIVATE_SHADOW=NO
SAFE_TO_PUBLISH=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_REMOTE_ACCESSED=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r8c_selective_checkpoint_and_deploy_package.json`, SHA256 `444fc1fd0a8900ed4f5f5324c5da1d96c1de7fa76407f1162ca61a288e022f73`.

## Rodada A3.7-A-R9 — Reconciliação pós-deploy e preparação do próximo gate de canário

### Deploy manual concluído (evidência do operador)
O operador autorizou e executou o deploy manual do archive `persi-next-e11d890-a37a-r8-node22.tar` em staging, com `PIM_PUBLICATION_MODE=off`, `PIM_SHADOW_SAMPLE_RATE=0`, `PIM_SHADOW_TELEMETRY_SINK=noop` confirmados antes do deploy. PDP `/abracadeira-condulete-top-pvc-cinza-3-4-para-fixacao-de-eletroduto-tigre` abriu normalmente; logs mostraram startup normal do Next.js 16.3.1; **zero** novos eventos `[pim-catalog-shadow]`. Avisos preexistentes não relacionados (`[woocommerce-free-shipping]`, imagens ausentes em `/images/brand` e `/images/footer`) foram apenas classificados como fora de escopo, não investigados.

### Classificação das 4 evidências (nunca misturadas)
`CODE_QUALIFICATION` (auditoria própria do código: 678/678, tsc limpo, 12 propriedades semânticas confirmadas), `ARCHIVE_QUALIFICATION` (validação do pacote isolado: 552/630 bruto, causa raiz 100% não relacionada à R8, tsc limpo, `build:offline` passou com `actualExternalRequests=0`), `OPERATOR_DEPLOY_EVIDENCE` (o que o operador relatou ter feito) e `LIVE_RUNTIME_EVIDENCE` (o que o operador relatou ter observado rodando). `552/630` preservado verbatim — **não** reclassificado como `630/630`.

### Integridade semântica R8, reconfirmada (Seção 2)
Diff zero desde o commit. Distinção explícita: `VOCABULARY_EQUIVALENCE` (o que a R8 adiciona — só o `code`) ≠ `VALUE_EQUIVALENCE` (pré-existente, só normalização literal de unicode/espaço) ≠ `REAL_VALUE_DIFFERENCE` (nunca escondida). Nenhuma regra excessivamente permissiva encontrada — sem HARD STOP.

### Gates de regressão fail-closed (Seção 3) — todos PASS
A. NEEDS_REVIEW, B. association unpublished, C. batch rolled_back/inactive, D. publication orphan, E. ownership de outro batch, F. malformed/unknown vocabulary, G. diferença de valor real — todos confirmados com teste nomeado específico ainda passando.

### Invariantes shadow/read-model (Seção 4) — todos PASS
Confirmado via `git diff HEAD~1 HEAD --stat`: o commit R8 tocou exatamente 2 arquivos — todo o resto do pipeline (`publication-shadow-runtime.ts`, `publication-flags.ts`, `publication-read-model.ts`, `publication-exposability.ts`, `publication-candidate.ts`, `publication-eligibility.ts`, `publication-service.ts`, `publication-shadow-telemetry.ts`, `productShadow.ts`) está intocado. `mode=off`, `sample<=0`, `sink=noop`, dedup por RSC, timeout/sink — todos intactos.

### Próximo canário (Seção 6) — achado central desta rodada
**Ainda não há candidato confirmado para MATCH/VALUE_DIFFERENCE.** 0117/PVCB5M continuam os únicos totalmente qualificados, mas ambos são `PIM_ONLY` confirmado (útil só como canário mecânico/controle negativo). Os outros 11 produtos ELIGIBLE_NOW permanecem `OPERATOR_PDP_READ_REQUIRED` da R7 — o acesso ao PDP desta rodada (R9/deploy) foi só um teste de runtime, não uma leitura de conteúdo da Ficha Técnica. Nenhum candidato foi inventado. Reafirmadas as mesmas 3 verificações operator-check da R7 (RP2M, 05646, 04220) como o próximo passo mínimo necessário. `PA013710/comprimento` e `NMEM16/comprimento` permanecem excluídos (registry); `NMEM16/material=PVC` não deve ser confundido com o comprimento bloqueado.

### Migration/policy reconciliation (Seção 8) — auditoria local apenas
`supabase/migrations/20260917120000_admin_membership_server_read_policy.sql` existe, untracked. `create policy` **não é idempotente** (sem `IF NOT EXISTS`/`DROP POLICY IF EXISTS`) — reaplicar falha com erro de objeto duplicado. Como foi aplicada manualmente via SQL Editor (não via `supabase db push`), a `schema_migrations` remota provavelmente não a conhece — um futuro `db push` deve falhar nela. Recomendação para rodada separada: confirmar via leitura (`supabase migration list`) e, se confirmado, usar `supabase migration repair --status applied` (nunca reexecutar o SQL). Nenhuma ação tomada nesta rodada.

### Gate final
```
A37A_R9_PASS=YES
```
```
SAFE_TO_REQUEST_CONTROLLED_PUBLICATION=NO
SAFE_TO_ACTIVATE_SHADOW=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_REMOTE_ACCESSED=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r9_post_deploy_reconciliation_and_next_canary_gate.json`, SHA256 `d65064812d5a54340b83a4295a5661a7924d3ac682480fa48cb7b420e0be8077`.

## Rodada A3.7-A-R10 — Coleta de evidência de Ficha Técnica (HARD STOP por falta de acesso)

### Motivação
Coletar o conteúdo real da Ficha Técnica oficial de RP2M, 05646 e 04220 — os 3 produtos pendentes desde a R7/R9 — para determinar se algum fornece um candidato real de `MATCH`/`VALUE_DIFFERENCE`/`VOCABULARY_EQUIVALENCE`.

### Matriz de evidência necessária (Fase 2)
Lado PIM já conhecido (recuperado do artefato local da R6B, sem nova leitura de banco): RP2M (comprimento=2m, material=Alumínio), 05646 (conexao=Compressão, material=Cobre), 04220 (material=PVC). Nenhuma dessas 5 associações pertence a `PA013710/comprimento` ou `NMEM16/comprimento` (os únicos bloqueios do registry) — confirmado explicitamente.

### Determinação do canal de leitura (Fase 3) — HARD STOP
O painel admin PIM (`/admin/products/[id]`) **não** expõe o valor oficial/Woo da Ficha Técnica pública — só o lado PIM, já conhecido. O valor oficial só existe renderizado na própria PDP pública. Esta sessão **não possui** navegador/runtime autenticado nem credenciais de login admin, e staging é protegido (login+MFA) — nenhuma tentativa de acesso remoto foi feita, nenhum endpoint/script/API temporário foi criado. **HARD STOP acionado antes de qualquer conclusão semântica**, exatamente como a rodada instruiu para este cenário.

### Instruções exatas para o operador
Para cada um dos 3 SKUs: abrir a URL pública de staging, observar somente a seção "Ficha Técnica", e reportar por campo — aparece ou não, e se aparecer, o valor exato (texto, nunca print da página inteira, nunca segredo). Não é necessário abrir o admin panel desta vez (lado PIM já conhecido). Detalhe completo no artefato.

### Classificações (Fase 4)
Todas as 5 associações: `INSUFFICIENT_EVIDENCE` — nenhuma conclusão semântica foi feita sem evidência real, conforme instruído.

### Canário (Fase 5)
`candidate_manifest=[]`, `candidate_product_count=0`, `candidate_association_count=0`, `operator_evidence_required=true`. Nenhum candidato foi inventado.

### Migration pendente (Fase 6)
`supabase/migrations/20260917120000_admin_membership_server_read_policy.sql` — intocado, nenhum `db push`/`migration repair`/`create policy`/`drop policy` executado.

### Gate final
```
R10_PREFLIGHT_PASS=YES
R10_PRODUCTS_REQUESTED=3
R10_PRODUCTS_WITH_SUFFICIENT_EVIDENCE=0
R10_ASSOCIATIONS_CLASSIFIED=5 (todas INSUFFICIENT_EVIDENCE)
CANARY_MANIFEST_READY=NO
OPERATOR_EVIDENCE_REQUIRED=YES
SAFE_TO_REQUEST_CONTROLLED_PUBLICATION=NO
```
```
SAFE_TO_ACTIVATE_SHADOW=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r10_ficha_tecnica_evidence_and_canary_selection.json`, SHA256 `ac4fe305e1dd1c8a21879cb37d15c3540ea1621ed4a1a398766044594ca05e73`.

## Rodada A3.7-A-R10-R1 — Reconciliação da evidência do operador

### Evidência recebida
O operador coletou manualmente os 3 PDPs pendentes. Resultado: **5/5 ausentes** da Ficha Técnica oficial — RP2M (Comprimento, Material), 05646 (Conexão, Material), 04220 (Material). Único campo exibido em cada um: Marca (Persi/Sfor/Tigre) e, no caso do 04220, também Cor=Cinza. O título do produto (que menciona "Alumínio"/"2m") foi explicitamente **não tratado** como presença na Ficha Técnica, conforme instruído.

### Classificação (reconfirmada no código real)
Todas as 5: `candidateByCode.has(code)=true` (PIM tem valor válido e publication-eligible) e `officialByCode.has(code)=false` (Ficha Técnica realmente não lista o atributo, nem sob outro nome — Marca/Cor não são o mesmo atributo) → **`PIM_ONLY`** por `lib/pim/publication-shadow-comparison.ts` linhas 189-192, exatamente a mesma regra confirmada na R6C/R7/R8. Nenhuma das 5 é `VOCABULARY_EQUIVALENCE`/`MATCH`/`VALUE_EQUIVALENCE`, porque essas três exigem que AMBOS os lados carreguem o atributo — aqui o lado oficial não carrega sob nenhum rótulo.

### Gate crítico (Fase da R9) — não satisfeito
`CANARY_MANIFEST_READY=NO`. As 5 associações desta rodada, somadas às 5 de 0117/PVCB5M (R6C), dão **10/10 associações checadas = 100% PIM_ONLY** em toda a engagement até agora. Nenhum `MATCH`/`VALUE_DIFFERENCE`/`VOCABULARY_EQUIVALENCE` foi observado ainda. RP2M/05646/04220 servem apenas como canários mecânicos adicionais, mesma categoria de 0117/PVCB5M.

### Próximo passo mínimo (sem nova consulta remota)
Reutilizando a mesma lista de 13 elegíveis já qualificada na R6B (zero nova amostragem/query), restam 8 produtos nunca checados. Selecionados os próximos 5, na mesma ordem determinística já estabelecida, cobrindo os 3 tipos de atributo existentes na amostra (comprimento/material/conexao):

| SKU | Slug | Atributo a procurar | Valor PIM esperado |
|---|---|---|---|
| 600652 | cabo-flexivel-azul-750v-400-mm-100m-sil | Comprimento | 100m |
| 311C-41-MR | bota-de-seguranca-camurca-marrom-no41-dellani | Material | PVC |
| 036612 | escada-articula-de-aluminio-4x3-degraus-sem-plataforma-alumasa | Material | Alumínio |
| 1135156 | jogo-de-bits-ph2-1-4-pol-25mm-com-2-pecas-gross | Material | Aço |
| 450306 | km-prensa-cabo-completo-pg-29-ccp | Conexão | Roscável |

(3 restantes de reserva se ainda faltar evidência depois destes 5: 19138/CPVC, 19153/CPVC, 63E-1025/10m — no artefato.)

### Gate final
```
R10R1_OPERATOR_EVIDENCE_ACCEPTED=YES
R10R1_ASSOCIATIONS_RECLASSIFIED=5 (todas PIM_ONLY)
CANARY_MANIFEST_READY=NO
ADDITIONAL_OPERATOR_EVIDENCE_REQUIRED=YES
SAFE_TO_REQUEST_CONTROLLED_PUBLICATION=NO
```
```
SAFE_TO_ACTIVATE_SHADOW=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_REMOTE_ACCESSED=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r10r1_operator_evidence_reconciliation.json`, SHA256 `0c89c7e8802ae49b18d0b6b107677a194ae397fe88e20fd1bea196dd86a485a0`. Artefato da R10 preservado sem alteração.

## Rodada A3.7-A-R11 — Mudança de estratégia: readiness de aprovação PIM e menor lote humano

### Mudança de estratégia
Parar de procurar `MATCH` aleatoriamente produto por produto. `PIM_ONLY` passa a ser aceito como comportamento mecânico válido para o primeiro canário — não é sucesso final, mas prova o pipeline publish→read model→shadow→rollback.

### Três trilhas de estado independentes (Seção 2)
1. **Workflow editorial** (`pim_product_profiles.workflow_status`) — conteúdo comercial do produto, não afeta elegibilidade de atributo.
2. **Revisão por atributo** (`pim_attribute_reviews`/`pim_attribute_decisions`/`pim_suggestions`) — decisão por valor específico, ação `reviewAttribute` (permissão `pim.attribute.review`).
3. **Publicação** (`pim_publication_batches`/`pim_attribute_publications`) — **sem nenhuma ação de UI no painel admin** (grep exaustivo confirma zero chamada a `publishBatch`/`preparePublication`/`unpublishBatch` em `app/`).

### Achado central (Seção 5)
`evaluatePublicationEligibility()` trata a **ausência** de uma linha em `pim_attribute_reviews` como NÃO-bloqueante — só uma linha EXISTENTE com `needs_review`/`rejected` bloqueia. Logo: **valores canônicos podem ser publication-eligible sem nunca terem sido formalmente aprovados por humano** — confirmado exatamente o caso das 9 associações auditadas (RP2M, 05646, 04220, 600652, 311C-41-MR, 036612, 1135156) mais 0117/PVCB5M: todas `reviewStatus=null`, todas `PUBLICATION_ELIGIBLE=true`, nenhuma jamais revisada.

**Achado de permissão**: o papel atual de Eduardo em staging é `PIM_APPROVER`, que **não** tem a permissão `pim.attribute.review` (essa pertence só a `PIM_REVIEWER`/`ADMIN`) — ele não pode registrar formalmente uma aprovação por atributo pelo painel hoje, embora isso não seja tecnicamente exigido pela elegibilidade.

### Hipótese da Ficha Técnica confirmada (Seção 6)
`PIM_PUBLICATION_MODE=off` **e** `PIM_PUBLICATION_MODE=shadow` mantêm a resposta pública 100% Woo-only — a Ficha Técnica pública nunca lê nenhuma tabela PIM, publicada ou não; o shadow é fire-and-forget, sem caminho de volta à resposta. Confirmado pelo código (`services/catalog/woocommerce.ts` + `services/catalog/productShadow.ts`), inalterado desde a R9.

### Menor lote (Seção 7)
`0117` + `PVCB5M`, 5 associações — já o menor lote possível, com mais evidência acumulada (5+ rodadas) de todo o conjunto. `EXPECTED_SHADOW_CLASSIFICATION=PIM_ONLY` para as 5, sustentado por evidência humana direta, não suposição.

### Plano de aprovação humana (Seção 8) — recomendação, não requisito
Para cada uma das 5 associações: conferência visual opcional no painel (não exigida pelo código). Blocker técnico registrado: o papel `PIM_APPROVER` não permite executar essa aprovação formal hoje.

### Manifesto preliminar (Seção 9)
5 linhas preparadas, `approval_state=NOT_REVIEWED (not required)`, `publication_eligible=true` para todas. Nenhum `publishBatch()` chamado, nenhum batch criado.

### Testes (Seção 11)
`PERSI_OFFLINE_VALIDATION=1 npm run test:pim`: 678/678. `tsc --noEmit`: limpo. `FILES_CHANGED=[]`.

### Gate final
```
R11_PREFLIGHT_PASS=YES
R11_WORKFLOW_AUDIT_PASS=YES
R11_CANDIDATE_READINESS_PASS=YES
R11_ADMIN_CAPABILITY_AUDIT_PASS=YES
R11_STOREFRONT_BEHAVIOR_CONFIRMED=YES
SAFE_TO_REQUEST_HUMAN_APPROVAL=YES
SAFE_TO_REQUEST_CONTROLLED_PUBLICATION=YES (pré-requisitos de elegibilidade satisfeitos -- execução real ainda exige combinar COMO publicar, já que não há ação de UI, e permanece sem autorização nesta rodada)
```
```
SAFE_TO_ACTIVATE_SHADOW=NO
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r11_pim_approval_readiness_and_minimal_human_plan.json`, SHA256 `5eb0395e4d7e68329b8251a850523ef59788dd0c6e1210a6598f3a8a74ad1daf`.

## Rodada A3.7-A-R12 — Qualificação local do executor mínimo de publicação (dry-run)

### Objetivo
Resolver o blocker operacional da R11 (nenhuma UI chama `publishBatch`/`unpublishBatch`) qualificando LOCALMENTE um executor CLI mínimo, fino, sobre os serviços já existentes — sem publicar nada em staging.

### Manifesto exato recuperado (Seção 2)
As 5 associações + fingerprint (`32a0b3448a289abf2b290e8182606505c9fac31a7d4937f9ae3c6fb51a3b55bf`) foram recuperadas verbatim do artefato da R6C (`phase4_final_manifest`) — nenhum ID reconstruído por SKU, nenhum inventado, nenhuma ambiguidade. Baseline reference: `4b4cb3da092ebea4837850249f82c56543e0fac42c11b680ec315a26d462399d`.

### Executor (Seções 3-4)
Novo `scripts/database/pim-publication-canary-executor.mjs` — camada fina, importa e chama diretamente `preparePublication`/`publishBatch`/`unpublishBatch`/`getPublicationState`/`computeMemberFingerprint` de `lib/pim/publication-service.ts` (zero reimplementação). Ações explícitas `dry-run|prepare|publish|reconcile|rollback`. Manifesto `Object.freeze()`d, hardcoded — zero wildcard, zero auto-discovery, zero "publish all" implícito.

### Target guard reaproveitado (Seção 5)
Reutiliza `checkDatabaseBinding()`/`EXPECTED_STAGING_PROJECT_REF` de `lib/pim/publication-runtime-preflight.ts` — o MESMO mecanismo que já protege o shadow runtime. Validação semântica pelo project ref real do Supabase, nunca substring de hostname (provado por teste: uma URL com host `staging.example.com` mas project ref errado ainda é rejeitada).

### Segurança transacional (Seção 6) — nada reimplementado
`publishBatch`/`unpublishBatch` já são transações únicas com advisory lock; o executor nunca abre transação própria nem contorna isso. Publicação parcial é estruturalmente impossível (tudo ou nada, provado empiricamente: uma tentativa de batch rejeitada por ownership cruzado criou zero linhas).

### Qualificação dry-run local (Seção 7) — 14/14 cenários
18 testes unitários puros (`tests/pimA37AR12PublicationExecutorGuards.test.mjs`, sem banco) cobrindo manifesto/target/actor. Mais uma qualificação de integração real contra Postgres descartável Docker (`scripts/database/pim-publication-canary-executor-disposable.mjs`, mesmo padrão de `pim-publication-foundation-disposable.mjs`), chamando as FUNÇÕES REAIS de `publication-service.ts` contra um manifesto de teste local (não os IDs reais de staging, já verificados separadamente na R6B/R6C). Todos os 14 cenários pedidos passaram: happy-path, associação faltando/extra, SKU errado, fingerprint errado, `NEEDS_REVIEW`, inelegível (conflito aberto), ownership cruzado, actor ausente, target produção/desconhecido, replay idempotente sem duplicatas, escopo de rollback exato (segundo batch intocado), e invariância das fontes PIM (valores byte-idênticos antes/depois de publish+rollback).

### Testes (Seção 11)
`PERSI_OFFLINE_VALIDATION=1 npm run test:pim`: **696/696** (678 pré-existentes + 18 novos). `tsc --noEmit`: limpo. Container Docker descartável limpo ao final (confirmado, zero container remanescente).

### Plano de rollback e de execução futura (Seções 8-9) — preparados, não executados
Sequência completa documentada no artefato: preflight read-only → dry-run → HARD GATE humano → prepare → reconcile 0/0 → publish → reconcile 5/5 → verificar invariância → HARD STOP, sem ativar shadow na mesma autorização (exige rodada separada).

### Gate final
```
R12_EXECUTOR_QUALIFIED=YES
R12_DRY_RUN_QUALIFICATION_PASS=YES (14/14 cenários)
SAFE_TO_REQUEST_CONTROLLED_STAGING_PUBLICATION=YES
```
```
SAFE_TO_ACTIVATE_SHADOW=NO
SAFE_TO_EXECUTE_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_REMOTE_ACCESSED=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r12_minimal_publication_executor_qualification.json`, SHA256 `1b32f9c7ae39c902fac58b725c7818560d9f5bd7a2522104cf52c2e41f4ff9ed`.

## Rodada A3.7-A-R13 — Publicação controlada executada em staging (PRIMEIRA ESCRITA REAL)

### Marco desta rodada
Pela primeira vez em toda a engagement A3.7, uma escrita real foi autorizada e executada em persi-staging: publicação das 5 associações qualificadas (0117: comprimento/conexao/material; PVCB5M: comprimento/material), usando exclusivamente o executor já qualificado na R12 (`scripts/database/pim-publication-canary-executor.mjs`), sem reimplementar nenhuma regra dos serviços já existentes.

### Preflight local e de staging (Fases 1-2)
Hash do artefato R12 reconfirmado. Todas as constantes do executor (fingerprint/SKUs/contagens/target) batem exatamente com a autorização. Leitura read-only de staging confirmou: 5/5 associações existem, valores canônicos batem, nenhuma revisão pendente, nenhuma já publicada, nenhum conflito, nenhuma pertence a outro batch ativo, fingerprint recalculado bate exatamente. Baseline capturado: `batches=1, rows=8, published=0, unpublished=8, audit=2028`.

### Dry-run real contra staging (Fase 3)
Executado via o executor qualificado, zero escrita: `TARGET=staging (project ref vtrujmhhkmvjzfklzxip confirmado)`, `5/5 elegíveis`, `0 needs_review`, `0 conflito cross-batch`, `WOULD_PUBLISH=5`.

### Prepare e reconcile prepare (Fases 5-6) — achado de nomenclatura
`prepare` (por design já qualificado na R12) não escreve nada — apenas valida e gera um `batchId` (`5cab6afa-72c9-4cdd-b520-5cd4262bc154`). A "reconciliação de prepare" confirmou `BATCH_EXISTS=NO` (zero linhas antes do publish) — o invariante correto e mais forte para esta ferramenta, não uma falha.

### Publish e reconciliação final (Fases 7-8)
`publishBatch()` real executado: `status=active, publishedCount=5, idempotentReplay=false`. Reconciliação final: 5/5 `published`, fingerprint e baseline do batch conferem exatamente, zero linha extra, zero duplicata, zero linha faltando. Deltas exatos: `PUBLICATION_BATCHES 1→2`, `PUBLICATION_ROWS 8→13`, `PUBLISHED_ROWS 0→5`, `UNPUBLISHED_ROWS 8→8 (inalterado)`, `PIM_AUDIT 2028→2033` (+5, uma linha `ATTRIBUTE_PUBLISHED` por associação, todas atribuídas a este batch). Valores-fonte PIM (`product_attribute_values`/`attribute_values`) confirmados byte-idênticos antes/depois. Zero mapeamento WooCommerce tocado nos últimos 5 minutos.

### Shadow gate (Fase 9)
Shadow NÃO foi ativado. Nenhum PDP acessado para gerar telemetria. Confirmado por leitura de código (reconfirmado, não só assumido): `publication-service.ts` nunca lê `PIM_PUBLICATION_MODE` — a escrita desta rodada é estruturalmente independente do estado do shadow.

### Rollback readiness (Fase 10) — não executado
Publicação reconciliou 5/5 sem qualquer inconsistência — rollback não foi e não deveria ser executado. Procedimento exato documentado no artefato para uma rodada futura, caso necessário.

### Gate final
```
R13_PUBLISH_PASS=YES
R13_FINAL_RECONCILIATION_PASS=YES
R13_SOURCE_INVARIANCE_PASS=YES
R13_SHADOW_REMAINED_OFF=YES
CANARY_BATCH_ID=5cab6afa-72c9-4cdd-b520-5cd4262bc154
CANARY_BATCH_STATE=active
CANARY_PUBLISHED_ROWS=5/5
AUTHORIZATION_CONSUMED=YES
SAFE_TO_REQUEST_CONTROLLED_SHADOW_ACTIVATION=YES (apenas significa que uma NOVA autorização pode ser solicitada — shadow não foi ativado)
```
```
SAFE_TO_EXECUTE_ANY_NEW_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r13_controlled_staging_publication_execution.json`, SHA256 `f0b6519af6d248b8952d9bfb4b5d7e86065e5a26ad14a7e5d1dd567bacfe57ff`.

## Rodada A3.7-A-R14 — Observação de shadow controlada (BLOQUEADA antes da ativação — sem canal técnico)

### Preflight local e de código (Seção 1) — PASS
HEAD confirmado inalterado (`e11d890`), artefato R13 reconfirmado por SHA256. Reconfirmadas no código real (nenhuma alterada desde a R8): shadow nunca altera a resposta oficial, sink console é `server-only`, dedup via `React.cache()` presente, proteção de timeout presente, proteção contra rejeição assíncrona do sink presente (duas camadas), `mode=shadow` reconhecido, `sample=100` = 100%, modo desconhecido cai em `off` (fail-closed), nenhuma rota de listagem/categoria/busca conectada.

### Precheck read-only de publicação (Seção 2) — PASS
Batch `5cab6afa-72c9-4cdd-b520-5cd4262bc154` confirmado `active`, fingerprint bate exatamente, 5/5 linhas `published` com os valores corretos, totais idênticos ao estado final da R13 (`batches=2, rows=13, published=5, audit=2033`). Zero escrita.

### Bloqueio antes da ativação (Seção 4)
Uma busca ativa por ferramentas confirmou: os servidores MCP `hostinger-hosting`/`hostinger-agency-hosting` (que exporiam variáveis de ambiente Node.js) permanecem desconectados (`CONNECT_TIMEOUT`) — apenas DNS/domains/billing/reach do Hostinger estão acessíveis, nenhum deles capaz de alterar env vars ou ler logs do runtime Node.js. **Nenhuma tentativa de contorno foi feita.** Conforme instruído explicitamente para este cenário: nenhuma ativação foi simulada, nenhuma observação de PDP foi inventada, e a rodada para aqui com HARD STOP, aguardando o operador executar manualmente e retornar com evidência.

### Instruções exatas entregues ao operador
Passo a passo completo no artefato: alterar somente as 3 variáveis (`PIM_PUBLICATION_MODE=shadow`, `PIM_SHADOW_SAMPLE_RATE=100`, `PIM_SHADOW_TELEMETRY_SINK=console`), acessar cada PDP (0117: `tubo-pvc-branco-roscavel-1-2-krona-6m`; PVCB5M: `forro-pvc-em-regua-frisado-branco-7mm-x-20cm-x-5m`) uma única vez, coletar exatamente 1 linha `[pim-catalog-shadow]` por acesso, restaurar imediatamente `off/0/noop`, e retornar com as 2 linhas de log + confirmação da restauração.

### Gate final
```
R14_PREFLIGHT_PASS=YES
R14_PUBLICATION_PRECHECK_PASS=YES
R14_SHADOW_ACTIVATION_PASS=NÃO EXECUTADO (sem canal técnico)
R14_CONTROLLED_SHADOW_PASS=NÃO CONCLUÍDO
SAFE_TO_PREPARE_PIM_FICHA_CANARY=NO (ainda pendente da observação real)
```
```
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO (por este agente)
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r14_controlled_published_pim_shadow_observation.json`, SHA256 `ba99cec58de8338310227bc21a6e36e9ad9a36e22d2bf6809f8b857aff4e5ca4`.

## Rodada A3.7-A-R14-R1 — Causa raiz do evento multi-produto (achado arquitetural)

### O que aconteceu
O operador executou a observação manual da R14: 1 acesso lógico ao PDP de 0117 produziu **3 eventos de shadow telemetry**, com 3 `productId` diferentes.

### Identificação dos 3 produtos (leitura read-only mínima)
| productId | SKU | Slug | Papel |
|---|---|---|---|
| `1b26a877...` | **0117** | tubo-pvc-branco-roscavel-1-2-krona-6m | **MAIN_PDP** (o produto realmente acessado) |
| `37e3e68b...` | 0122 | tubo-pvc-branco-roscavel-2-krona-6m | RELATED_PRODUCT (irmão de família, navegação anterior/próximo) |
| `94d87bda...` | 0118 | tubo-pvc-branco-roscavel-3-4-krona-6m | RELATED_PRODUCT (irmão de família, navegação anterior/próximo) |

### Causa raiz provada (não suposição)
`scheduleProductShadow()` tem **exatamente 1 call site em todo o repositório**: dentro de `getProductBySlug()` (`services/woocommerce/products.ts:290`), incondicional. `getProductBySlug()` tem 5 call sites — a maioria para o MESMO slug do PDP principal (deduplicados corretamente pelo `React.cache()`, confirmando que a correção da A3.6-D2-C-R1 **não regrediu**). Mas `services/woocommerce/productNavigation.ts`'s `getFamilyNavigation()` (linhas 89-94) chama `getProductBySlug()` **duas vezes, com slugs DIFERENTES** (o produto anterior/próximo da mesma família de produto — aqui, os outros diâmetros do mesmo tubo Krona) — o `React.cache()` não tem como saber que essas são chamadas "incidentais": ele deduplica por argumento, e slugs diferentes nunca colidem. Isso gera 2 eventos extras, sempre que o produto pertence a uma "família" (`getFamilyNavigation` é tentado ANTES do fallback `getCategoryNavigation`, que por sua vez **nunca** chama `getProductBySlug` — logo produtos sem família não teriam esse problema).

### Prova positiva do pipeline (não invalidada pela anomalia)
O EVENT do produto principal (0117) bate exatamente com o esperado: `publishedAttributeCount=3` (as 3 associações reais publicadas na R13), `differenceCount=5` (3 PIM_ONLY + 2 OFFICIAL_ONLY de Cor/Marca), `classification=PIM_ONLY` (regra de severidade "pior primeiro" do próprio código) — confirmação completa e exata de publication→read model→runtime→comparator→telemetry.

### Decisão semântica
O shadow de PDP **deve** observar somente o produto principal da rota (opção A), nunca produtos carregados incidentalmente — por interpretabilidade de telemetria, correção de sampling (hoje amostra pelo slug de QUALQUER produto que `getProductBySlug` resolver, não o realmente visitado), custo de banco, ruído, e isolamento de `routeKind`.

### Correção mínima proposta (NÃO implementada)
Mover `scheduleProductShadow(product)` de dentro de `getProductBySlug()` para o único call site que representa de fato "o assunto da rota" — a página do PDP (`app/_storefront/product-page.tsx`, próximo à linha 123). `getProductBySlug` passa a ser uma busca pura, sem efeito colateral; todo chamador atual (resolvedor de rota, metadata, navegação de família, API de catálogo) deixa de disparar shadow automaticamente. Preserva Woo oficial, produtos relacionados, `React.cache`, cache do Next, read model, shadow de listagem/busca futuro, sampling (melhora — passa a usar o slug real da rota), timeout e sink.

### Gate final
```
R14R1_ROOT_CAUSE_PROVEN=YES
R14R1_THREE_PRODUCTS_IDENTIFIED=YES
SKU_0117_PUBLISHED_PIPELINE_REACHED=YES
R14_CONTROLLED_SHADOW_PASS=NO (achado arquitetural pendente de correção)
SAFE_TO_IMPLEMENT_FIX_LOCALLY=YES
```
```
SAFE_TO_REACTIVATE_SHADOW=NO
SAFE_TO_EXECUTE_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
FINAL_PIM_PUBLICATION_MODE=off
FINAL_PIM_SHADOW_SAMPLE_RATE=0
FINAL_PIM_SHADOW_TELEMETRY_SINK=noop
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r14r1_multi_product_shadow_root_cause.json`, SHA256 `31d07e5812146995cdf421576e700ac9beb7a9686e945f287f857804c5b7cdde`.

## Rodada A3.7-A-R14-R2 — Correção implementada e qualificada localmente (sem deploy)

### Correção mínima aplicada
`scheduleProductShadow(product)` removido de dentro de `getProductBySlug()` (`services/woocommerce/products.ts`) — essa função volta a ser puramente busca de dados. Chamada explícita adicionada em `app/_storefront/product-page.tsx`, logo após o guard `notFound()`, exatamente onde `product` já é comprovadamente o produto principal da rota. `services/woocommerce/productNavigation.ts` **não foi tocado** — nenhum hack por SKU, nenhuma flag específica de produto, correção puramente estrutural.

**Cuidado com WIP concorrente**: `product-page.tsx` já tinha alterações não relacionadas em andamento (layout de galeria, `key={product.id}`, reposicionamento de `ProductDetails`) — editado cirurgicamente por cima, com cada hunk preexistente confirmado intocado depois.

### Auditoria de call sites após a correção
Ocorrências produtivas de `scheduleProductShadow(`: **1 antes, 1 depois** — só mudou de lugar. `git grep` repo-wide confirma exatamente essa única ocorrência, agora em `product-page.tsx`. Todo outro chamador de `getProductBySlug` (metadata, resolvedor de rota, navegação de família, API de catálogo) classificado e confirmado como **não** disparando shadow.

### Testes (10 exigidos + extras)
Novo arquivo `tests/pimA37AR14R2MainPdpOnlyShadowScope.test.mjs` (11 testes) cobre exatamente os 10 cenários pedidos. Dois testes existentes (`pimA36D2CR1DuplicateShadowExecutionFix.test.mjs`, `pimA36BOfficialResponseInvariance.test.mjs`) atualizados porque codificavam a arquitetura antiga (shadow dentro de `getProductBySlug`) — a alegação real de cada um (dedup via `cache()`, fire-and-forget nunca `await`) permanece intacta, só a localização mudou, com comentário explicando o porquê.

### Validação offline
`PERSI_OFFLINE_VALIDATION=1 npm run test:pim`: **708/708** (678 anteriores + 11 novos + 19 nas atualizações). `tsc --noEmit`: limpo. `npm run build:offline`: build completo com sucesso, `actualExternalRequests=0` (110 tentativas Woo + 1 Instagram bloqueadas) — mesmo mecanismo já usado na R8C, evitando repetir o incidente histórico de build tocando produção Woo.

### Diff audit
Exatamente 4 arquivos alterados: `services/woocommerce/products.ts`, `app/_storefront/product-page.tsx`, e os 2 testes atualizados — mais 1 novo arquivo de teste. Nenhuma migration, env, schema, publication service, regra semântica do comparador ou source switch tocados. Nenhuma alteração funcional em Woo além da remoção do efeito colateral.

### Gate final
```
R14R2_IMPLEMENTATION_PASS=YES
R14R2_CALL_SITE_AUDIT_PASS=YES
R14R2_MAIN_PDP_ONLY_PASS=YES
R14R2_OFFLINE_VALIDATION_PASS=YES
R14R2_DIFF_AUDIT_PASS=YES
SAFE_TO_REQUEST_STAGING_FIX_DEPLOY=YES
```
```
SAFE_TO_REACTIVATE_SHADOW=NO
SAFE_TO_EXECUTE_STAGING_WRITE=NO
SAFE_TO_CONNECT_PIM_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_REMOTE_ACCESSED=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r14r2_main_pdp_only_shadow_scope_fix.json`, SHA256 `61d11a6f2db6b72749a5992a2208fc27d385737ccabe0326863ba424d1517e02`.

## Rodada A3.7-A-R14-R3 — Checkpoint/pacote de deploy da correção (BLOQUEADA antes do deploy — sem canal técnico)

### Resolução da discrepância de cardinalidade
A R14-R2 falou em "4 arquivos" (de um `git diff --stat` restrito a 4 caminhos rastreados) mas listou 2 `FIX_FILES` + 3 `TEST_FILES`. Reauditado do zero: são **5 arquivos reais**, sem ambiguidade — o 5º (`tests/pimA37AR14R2MainPdpOnlyShadowScope.test.mjs`) era novo/untracked e por isso nunca apareceu naquele `git diff --stat` específico, embora já tivesse sido mencionado à parte no texto daquela rodada.

### Achado técnico: `app/_storefront/product-page.tsx` é arquivo MISTO
Esse arquivo tem 3 hunks: os 2 da correção R14-R2 (import + chamada `scheduleProductShadow`) e um 3º **totalmente não relacionado** (WIP concorrente de layout de galeria/`key={product.id}`/reposicionamento de `ProductDetails`, já presente antes desta rodada). Resolvido com precisão cirúrgica: `git apply --cached` com um patch de 2 hunks extraído manualmente, deixando o 3º hunk **intocado e não commitado** no working tree. Confirmado depois do commit: o arquivo ainda aparece como modificado (exatamente o hunk não relacionado, preservado).

### Checkpoint local seletivo
Commit `229e7b6929efe3084f812d303a46edc871254d32` — "fix(pim): schedule PDP shadow only for the route's main product" — exatamente os 5 arquivos R14-R2, `5 files changed, 233 insertions(+), 31 deletions(-)`. Sem push.

### Pacote de deploy
`git archive` do commit exato: `persi-next-229e7b6-a37a-r14r2-node22.tar`, SHA256 `c36e5bd39ff6f11f32928bb38ba82bfd3b7237443dcc1c48c406f315ee05cfaa`, 1627 arquivos, confirmado sem `.env`/`node_modules`/`.next`/secrets, todos os 5 arquivos da correção presentes.

### Bloqueio antes do deploy
Nova busca ativa de ferramentas confirma: nenhum canal técnico Hostinger (Node.js hosting/deploy) está conectado nesta sessão — mesma limitação da R14. Nenhuma tentativa de contorno, nenhum sucesso simulado. HARD STOP aguardando o operador aplicar o pacote manualmente.

### Gate final
```
R14R3_DIFF_CARDINALITY_RESOLVED=YES (5 arquivos, 0 ambíguos)
R14R3_FIX_VERIFIED=YES
R14R3_REGRESSION_GATE_PASS=YES (708/708, tsc limpo)
R14R3_PACKAGE_PASS=YES
DEPLOY_PERFORMED=NO
R14R3_STAGING_DEPLOY_PASS=NÃO CONCLUÍDO
SAFE_TO_REQUEST_CONTROLLED_SHADOW_RETEST=NO
```
```
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
GIT_COMMIT_PERFORMED=YES (local, sem push)
GIT_PUSH_PERFORMED=NO
```
Artefato: `scratchpad/a37a_r14r3_staging_fix_deploy.json`, SHA256 `0b6da183c74c0af033b0bb3f4c3a5356974b32d04a70546136bba9e3cac73ab3`.

## Rodada A3.7-A-R14-R5 — Reconciliação final do reteste de shadow + gate de exposição da Ficha Técnica

### Reconciliação R14-R4 (Objetivo A)
Evidência manual do operador confirmada, número a número, contra o código real: 0117 → 1 evento, `productId` correto, `publishedAttributeCount=3`, `differenceCount=5` (3 PIM_ONLY + 2 OFFICIAL_ONLY de Cor/Marca), `classification=PIM_ONLY` (regra de severidade "pior primeiro" do próprio código). PVCB5M → 1 evento, `publishedAttributeCount=2`, `differenceCount=4` (2+2), mesma classificação. **A correção da R14-R2 funciona em staging real** — exatamente 1 evento por produto, zero incidental.

### Reconciliação de publicação (Objetivo B)
Uma única leitura read-only confirma: batch `5cab6afa...` `active`, fingerprint e baseline batem, 5/5 `published`, totais **byte-idênticos** ao estado final da R13 (`batches=2, rows=13, published=5, audit=2033, reviews=5, conflitos=113`). Zero drift.

### Achado central (Objetivo C): a fundação para Ficha Técnica já existe, parcialmente pronta
`components/Product/ProductDetails.tsx` (Client Component) monta a seção a partir de `product.specifications ?? product.attributes...` — o mesmo array `Product.attributes` (com `.taxonomy`) que `mapWooProductToCatalog` já usa para o comparador de shadow, só que projetado de forma diferente (por `.name` em vez de `.taxonomy`).

**Descoberta importante**: `docs/pim/10-publication-architecture.md` já tem uma seção "Merge policy (design apenas)" e lista como próximo passo exatamente "conectar `getActiveCanaryMembership`/`getPublishedProductAttributes` ao storefront". E `getActiveCanaryMembership(productId)` **já existe, totalmente implementada e testada**, com **zero chamadores** hoje — ela filtra exatamente por `batch.kind='canary' AND status='active'`, o que já dá um allowlist natural e não-hardcoded (nosso batch da R13 foi criado com `kind:'canary'`).

### Matriz de merge (refinada, não copiada da doc antiga)
A doc antiga dizia "PIM prevalece" sempre que ambos os lados têm o atributo — isso é **permissivo demais** à luz da R7/R8. A matriz proposta usa as 8 classificações REAIS do comparador (não os rótulos conceituais da tarefa, que não existem todos como valores de runtime distintos — `VOCABULARY_EQUIVALENCE`/`VALUE_EQUIVALENCE` mapeiam para `MATCH`/`ORDER_ONLY_DIFFERENCE` reais): `PIM_ONLY`→adiciona; `MATCH`/`ORDER_ONLY_DIFFERENCE`→mantém Woo, nunca duplica; `OFFICIAL_ONLY`→mantém Woo; `VALUE_DIFFERENCE`/`MULTI_VALUE_DIFFERENCE`/`UNRESOLVABLE`→**fail-closed, nunca sobrescreve Woo**, gera observabilidade; `BLOCKED`/não-publicado/`NEEDS_REVIEW`→nunca exibe PIM. Achado de risco novo: uma revisão pode ser lançada DEPOIS da publicação sem despublicar automaticamente — proposta uma re-checagem fail-closed em tempo de leitura, além do gate histórico de publish-time.

### Seam de integração mínimo proposto
Mesmo call site já estabelecido pela R14-R2 em `product-page.tsx` (logo após `notFound()`), reaproveitando `mapWooProductToCatalog`/`buildPimCatalogCandidate`/`compareOfficialWithPimCandidate`/`getActiveCanaryMembership` — zero lógica de comparação nova. Gate por `mode==='canary'` checado primeiro, fail-closed com timeout curto, fallback para Woo-only em qualquer erro.

### Nenhuma implementação nesta rodada
Somente auditoria, design e plano de testes. Nenhum código alterado, nenhuma escrita, nenhum deploy.

### Gate final
```
R14R5_PUBLICATION_RECONCILIATION_PASS=YES
R14R5_FICHA_TECNICA_CALL_GRAPH_PASS=YES
R14R5_INTEGRATION_SEAM_IDENTIFIED=YES
R14R5_CANARY_DESIGN_READY=YES
R14R5_MERGE_MATRIX_READY=YES
R14R5_ROLLBACK_PLAN_READY=YES
R14R5_NEXT_TEST_PLAN_READY=YES
SAFE_TO_IMPLEMENT_FICHA_TECNICA_CANARY_LOCALLY=YES
SAFE_TO_REQUEST_FICHA_TECNICA_CANARY_DEPLOY=NO
```
```
SAFE_TO_CONNECT_PIM_GLOBALLY_AS_STOREFRONT_SOURCE=NO
SAFE_TO_REMOVE_WOO=NO
SAFE_TO_PRODUCTION=NO
STAGING_DB_WRITES_PERFORMED=0
PRODUCTION_ACCESSED=NO
ENV_CHANGED=NO
DEPLOY_PERFORMED=NO
GIT_COMMIT_PERFORMED=NO
GIT_PUSH_PERFORMED=NO
```
Próxima rodada recomendada: implementação LOCAL + qualificação do merge (mocks/fixtures, offline), sem deploy.

Artefato: `scratchpad/a37a_r14r5_shadow_retest_closure_and_ficha_tecnica_gate.json`, SHA256 `85a953e6e2d39991c7311ec60e19eec82ddbaa8401ae4d5e56c05a504b5d99b5`.
