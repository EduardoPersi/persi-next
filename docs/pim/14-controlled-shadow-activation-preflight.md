# Controlled Shadow Activation — Preflight (A3.6-D1)

**Esta rodada é planejamento. Nada foi ativado, implantado ou alterado remotamente.**

## 0. Achado crítico — gate de isolamento (Seção 6)

**Não existe, hoje, evidência de um ambiente de runtime Next.js (frontend) isolado de produção.**

Evidência coletada exclusivamente do repositório:

- `docs/19-deploy-hostinger.md` documenta **um único** processo de deploy: atualizar `main`, `build`, publicar, "validar o funcionamento em **produção**". Não há passo de deploy para staging.
- `.env.example` define `WORDPRESS_URL=https://loja.persimateriais.com.br` — o domínio de produção real — como o único valor documentado. Não existe uma URL de staging WooCommerce padrão.
- Memória de sessões anteriores (confirmada nesta engenharia): `.env.local` deste projeto aponta para `persimateriais.com.br` real, sem sandbox local.
- **Achado histórico relevante, mas não uma prova de disponibilidade atual**: `docs/35-checkout-next-etapa-5-staging.md` descreve que, para uma validação de concorrência de checkout, foi provisionado um ambiente WooCommerce/MySQL genuinamente separado de produção, com "duas instâncias independentes" do Next apontando para ele. Isso prova que a **capacidade** de criar tal ambiente já existiu no histórico do projeto — mas não há evidência de que essa instância específica continue ativa, seja conhecida/documentada como reutilizável, ou esteja disponível hoje para esta finalidade.

**Conclusão**: `persi-staging` (o projeto Supabase `vtrujmhhkmvjzfklzxip`) está corretamente isolado e é o alvo correto para o lado PIM/Postgres. Mas o **frontend Next.js** que efetivamente executaria `scheduleProductShadow`/`runPimCatalogShadow` em uma requisição real de PDP **não tem, hoje, um destino de deploy comprovadamente isolado de produção**. Ativar o shadow em "staging" hoje, sem provisionar tal ambiente, significaria necessariamente rodar contra o mesmo processo Next.js que serve `loja.persimateriais.com.br` real — ou seja, produção, com tráfego de clientes reais.

```
A3_6D1_ISOLATED_RUNTIME_ENVIRONMENT=NO
```

Por instrução explícita da tarefa, **este é um bloqueio, não uma sugestão para usar produção como substituto**. O restante deste documento qualifica tudo o que É seguro preparar mesmo com esse bloqueio (contrato de config, binding de banco, sink de telemetria, plano de rollback, etc.), mas a execução real (D2) não pode prosseguir até que este gate seja resolvido por uma decisão humana explícita sobre qual ambiente será de fato usado.

## A. Preflight
Branch/HEAD/worktree idênticos ao esperado, preservados. `PimPublicationOwnedByAnotherBatchError` e toda a implementação A3.6-A/B/C confirmadas intactas.

## B. Integridade A3.6-C
`a36c_shadow_activation_qualification.json` — SHA256 confere.

## C. Descoberta do ambiente de runtime
Ver Seção 0 acima.

## D. Isolamento de produção
`A3_6D1_ISOLATED_RUNTIME_ENVIRONMENT=NO`. Nenhuma requisição, leitura de painel ou alteração de produção foi feita nesta rodada.

## E. Topologia de deploy (como documentada/observável)

| Aspecto | Valor observado |
|---|---|
| Repositório | GitHub, branch principal `main` (branch atual de trabalho: `checkpoint/native-commerce-b3c-e2-20260908`, não commitada) |
| Build | `npm install && npm run lint && npm run build` (`next build`) |
| Start | `next start` (`package.json` scripts) |
| Node | LTS (conforme `docs/19-deploy-hostinger.md`) |
| Injeção de env | "Variáveis de ambiente configuradas no servidor" (Hostinger), mecanismo exato não documentado em detalhe |
| Trigger de deploy | Manual, conforme documentado ("Atualizar a branch principal... Publicar a nova versão") — não há CI/CD automatizado documentado |
| Ambientes conhecidos | **Um**: produção. Nenhum staging documentado para o frontend |

## F. Manifest de arquivos/deploy (local, não commitado)

Arquivos que compõem a feature de publicação/shadow, todos atualmente **não commitados** (`git status`):

```
lib/pim/publication-baseline.ts
lib/pim/publication-candidate.ts
lib/pim/publication-eligibility.ts
lib/pim/publication-exposability.ts
lib/pim/publication-flags.ts
lib/pim/publication-needs-review-registry.ts
lib/pim/publication-read-model.ts
lib/pim/publication-runtime-preflight.ts   (novo nesta rodada)
lib/pim/publication-service.ts
lib/pim/publication-shadow-comparison.ts
lib/pim/publication-shadow-runtime.ts
lib/pim/publication-shadow-telemetry.ts
services/catalog/productShadow.ts           (modificado)
```

Nenhum commit foi feito. Um futuro D2 exigirá, no mínimo: revisão humana do diff completo, `git add` seletivo (nunca `-A`), commit com mensagem descritiva, e só então push — tudo como autorização **separada**, nunca implícita nesta qualificação.

## G. Contrato de variáveis de ambiente

| Variável | Obrigatória | Secreta | Valores aceitos | Default | Runtime/build | Requer restart |
|---|---|---|---|---|---|---|
| `DATABASE_URL` | Sim (já existe, pré-requisito de todo o PIM) | **Sim** | connection string Postgres válida | nenhum (lança erro se ausente) | runtime (lido a cada `getDatabase()`) | Sim, na prática (confirmado empiricamente nas rodadas P3-F–P3-H: mudar o valor exige reiniciar o processo) |
| `PIM_PUBLICATION_MODE` | Não | Não | `off` \| `shadow` \| `canary` | `off` | runtime (lido a cada chamada) | Sim, na prática |
| `PIM_SHADOW_SAMPLE_RATE` | Não | Não | inteiro 0–100 | `0` | runtime | Sim, na prática |
| `PIM_SHADOW_TELEMETRY_SINK` | Não | Não | `noop` \| `console` | `noop` | runtime | Sim, na prática |

Nenhum valor secreto foi registrado neste documento ou no artefato desta rodada.

## H. Binding do banco de staging

Implementado nesta rodada (`lib/pim/publication-runtime-preflight.ts::checkDatabaseBinding`): extrai **somente** o project ref (`postgres.<ref>`, segmento não-secreto) de `DATABASE_URL` e compara com `vtrujmhhkmvjzfklzxip`. Nunca retorna a senha ou a string completa — seguro para log/print do resultado. Verificado nesta rodada contra o processo real: `{"present":true,"projectRef":"vtrujmhhkmvjzfklzxip","matchesExpectedStaging":true}`.

**Uso pretendido**: chamada uma vez no startup do processo (não em rota pública), com o resultado logado via o mesmo sink de telemetria (nunca um endpoint HTTP acessível).

## I. Prontidão do sink de telemetria

A3.6-C deixou `noop` como único destino real (nada observável). Esta rodada implementou a menor mudança necessária: `PIM_SHADOW_TELEMETRY_SINK=noop|console` (`lib/pim/publication-shadow-telemetry.ts::getConfiguredTelemetrySink`), lido pelo runtime (`publication-shadow-runtime.ts`) em vez do noop fixo anterior. Default continua `noop`; qualquer valor desconhecido também cai em `noop` (falha segura). **Nenhuma variável foi definida em nenhum ambiente real.**

**Resposta à pergunta crítica da Seção 12**: definir apenas `PIM_PUBLICATION_MODE=shadow` e `PIM_SHADOW_SAMPLE_RATE=1` **NÃO** tornaria os eventos observáveis — seria necessário **também** definir `PIM_SHADOW_TELEMETRY_SINK=console` para que os eventos saiam do noop e cheguem ao `console.info("[pim-catalog-shadow]", event)`, coletável pelos logs de runtime Node.js da Hostinger.

## J. Logging/observabilidade
Tag inequívoca `[pim-catalog-shadow]` já implementada (`consolePimShadowTelemetrySink`). Checklist para D2 observar (não executado agora):
- Eventos aparecem nos logs com a tag.
- Exatamente 1 evento por execução (já garantido estruturalmente, testado).
- Taxa de amostragem coerente com o configurado.
- Taxa de timeout / taxa de erro.
- Distribuição de `classification`.
- `durationMs` / p95.
- Nenhuma informação proibida no payload (já testado nesta e na rodada anterior).

## K. Sample rate inicial
Revalidado: **1** (1%), sem nova evidência que contradiga a recomendação da A3.6-C.

## L. Limitação zero-published
Staging tem `published=0`. Uma futura ativação em staging validará infraestrutura (runtime, sampling, conectividade, timeout, telemetria, isolamento) mas **não** validará qualidade de conteúdo PIM positivo — isso exige uma fase **separada** de canário de publicação, explicitamente não misturada com esta.

## M. Sequência de ativação (planejada, não executada)

```
DEPLOY (autorização separada)
  → confirmar mode=off
  → smoke test (home, PDP, categoria)
  → provar zero leitura PIM (checkDatabaseBinding + logs ausentes)
  → definir PIM_PUBLICATION_MODE=shadow, PIM_SHADOW_SAMPLE_RATE=1, PIM_SHADOW_TELEMETRY_SINK=console
  → restart do processo
  → observar (janela definida na Seção N)
  → reconciliar staging BEFORE/AFTER (zero escrita esperada)
  → PIM_PUBLICATION_MODE=off
  → restart
  → provar zero leitura PIM novamente
```

## N. Janela de observação e critérios de encerramento
Baseado em evidência, não apenas relógio: encerrar a janela quando **todos** forem verdadeiros — pelo menos N eventos coletados (N a definir com base no tráfego real do ambiente escolhido), pelo menos um evento de cada `shadowStatus` relevante observado ou período suficiente sem timeout/erro para confirmar estabilidade, zero mutação de staging confirmada, zero divergência na resposta oficial confirmada por amostragem.

## O. Condições de aborto
- Falha de requisição oficial atribuível ao shadow.
- `unhandledRejection` nos logs.
- Telemetria duplicada por requisição.
- `checkDatabaseBinding` retornando `matchesExpectedStaging:false` a qualquer momento.
- Qualquer mutação de staging detectada.
- Exceção do PIM vazando para a resposta HTTP.
- Resposta de PDP divergindo de shadow-off.
- Crescimento anormal de latência.
- Logs contendo segredo/PII.

## P. Rollback
```
PIM_PUBLICATION_MODE=off
```
+ restart do processo. Já comprovado estruturalmente (A3.6-B/C): `mode=off` é checado antes de qualquer acesso ao PIM, portanto remove 100% da leitura imediatamente após o próximo request do processo reiniciado.

## Q. Plano de invariância de resposta
Comparar campos semânticos oficiais da PDP (shadow off vs shadow ligado) via `deepStrictEqual` nos mesmos moldes de `tests/pimA36BOfficialResponseInvariance.test.mjs`/`tests/pimA36CShadowActivationQualification.test.mjs`, mas contra o ambiente real escolhido — **não executado nesta rodada** por depender do ambiente remoto que ainda não está definido (Seção 0).

## R. Baseline de staging (read-only, capturado nesta rodada)
```
pav=3265, av=168, audit=2028, batches=1, pubRows=8, published=0, unpublished=8, reviews=5, decisions=1, conflicts=115
```
Query read-only reutilizável para o manifesto BEFORE/AFTER de D2.

## S. Testes/TypeScript
`640/640 PASS` (9 novos: 5 de seleção de sink, 4 de binding de banco). `tsc --noEmit` limpo. Nenhuma alteração runtime relevante o suficiente para exigir build completo além do já coberto por tsc.

## T. Bloqueadores residuais para D2
1. **Bloqueador crítico**: nenhum ambiente de runtime Next.js isolado de produção comprovado. D2 não pode prosseguir sem uma decisão humana explícita sobre qual ambiente será usado (provisionar um novo staging genuíno, ou aceitar conscientemente o risco de rodar contra produção com salvaguardas adicionais — decisão que este agente não pode tomar sozinho).
2. Sink de telemetria precisa ser explicitamente configurado (`PIM_SHADOW_TELEMETRY_SINK=console`) além do modo/sample rate — documentado para não ser esquecido.
3. Mecanismo exato de injeção de variáveis de ambiente na Hostinger não está documentado em detalhe suficiente para escrever o comando exato — precisará ser confirmado no painel real durante D2.
