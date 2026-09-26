@AGENTS.md

# Regras de deploy no staging via Hostinger MCP (2026-09-26)

Complementa `AGENTS.md` §25.4 (Deploy targets) com o procedimento
operacional exato para deploy em staging usando as ferramentas MCP da
Hostinger. Vale para qualquer agente que tenha acesso a essas ferramentas.

## Ferramenta MCP a usar

Usar **somente** o conector `claude.ai Hostinger Connector`
(`mcp__claude_ai_Hostinger_Connector__*`). Os servidores MCP de
projeto/sessão `hostinger-hosting`, `hostinger-wordpress`,
`hostinger-agency-hosting`, `hostinger-domains`, `hostinger-dns`,
`hostinger-billing` têm histórico de falha de conexão (`CONNECT_TIMEOUT`)
e não são necessários para este fluxo — não tentar usá-los para deploy. Se
o conector `claude.ai Hostinger Connector` também estiver indisponível,
parar e reportar; não usar nenhum outro mecanismo (painel via browser
automation, script custom, etc.) sem autorização explícita.

## Escopo do site

- **Único site autorizado para deploy por este fluxo**:
  `staging.persimateriais.com.br` (usuário `u861559092`).
- **Nunca** `persimateriais.com.br` (produção — tem auto-deploy via Git,
  AGENTS.md §25.4, nunca via este fluxo de zip/build manual).
- **Nunca** `loja.persimateriais.com.br`.
- Antes de qualquer ação que identifique o site por id (não só por
  domínio), confirmar que o id corresponde a `staging.persimateriais.com.br`
  — nunca assumir pela posição numa lista.

## Proibições absolutas neste fluxo

- **Nunca alterar variáveis de ambiente pela API**
  (`hosting_replaceNode_jsEnvironmentVariablesV1` faz um *replace* de
  **todas** as variáveis de uma vez — chamar essa ferramenta com um
  conjunto incompleto apagaria senhas/chaves já configuradas). Variáveis de
  ambiente só são alteradas pelo dono, manualmente, pelo hPanel. Isto vale
  mesmo que a intenção seja só adicionar ou corrigir uma única variável.
- Nunca mexer em configuração de Git/auto-deploy, DNS, domínios, bancos de
  dados da Hostinger, cron jobs, SSL ou billing — nenhuma ferramenta desses
  domínios deve ser chamada a partir deste fluxo, em nenhuma circunstância,
  mesmo que pareça relacionada ao deploy.
- Nunca subir um zip que não tenha sido gerado por `git archive` a partir
  de um commit real deste repositório, e nunca subir sem antes conferir o
  SHA256 do arquivo contra o que foi reportado na entrega (mesmo padrão já
  usado nas rodadas anteriores deste projeto).

## Fluxo de deploy (zip → build → smoke test)

1. `generateUploadURL` para obter a URL de upload.
2. Upload do zip via **TUS** para `public_html`.
3. `startNode_jsBuild` com exatamente:
   - `node_version=22`
   - `app_type=next`
   - `output_directory=.next`
   - `build_script=build`
   - `package_manager=npm`
   - `source_type=archive`
   - `archive_path=<nome do zip enviado>`
4. Acompanhar o build até o status `completed` (poll com backoff — sucesso
   na resposta de início geralmente significa "enfileirado", não "pronto").
5. Ler os runtime logs depois que o build completar.
6. Rodar o smoke test correspondente (ex.:
   `scripts/staging/gate3-cart-checkout-smoke-test.mjs` ou o roteiro válido
   para a mudança em questão).

## Se o build falhar

Ler os build logs, reportar o erro exato ao dono. **Não tentar de novo
sem consultar** — nada de re-subir o mesmo zip, re-rodar o build, ou tentar
uma variação do comando por conta própria.
