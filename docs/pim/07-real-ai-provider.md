# PIM P.3B — provider real preparado

## Arquitetura e configuração

O motor depende de `PimEnrichmentProvider`; o adapter OpenAI fica em módulo `server-only` e usa o SDK oficial com Responses API e structured output. Modelo, limites e custos são lidos somente da configuração central `ai-config.ts`. `PIM_AI_ENABLED=false` é o padrão e a presença de `OPENAI_API_KEY` nunca ativa chamadas.

Variáveis: `PIM_AI_ENABLED`, `PIM_AI_PROVIDER`, `PIM_AI_MODEL`, `PIM_AI_MAX_OUTPUT_TOKENS`, `PIM_AI_TIMEOUT_MS`, `PIM_AI_RATE_LIMIT_PER_MINUTE`, `PIM_AI_MAX_ESTIMATED_COST_PER_REQUEST_MINOR`, custos de entrada/saída por milhão, `PIM_AI_INCLUDE_GTIN` e `OPENAI_API_KEY`. Nenhuma usa `NEXT_PUBLIC_`.

## Privacidade e evidência

`buildSafeAiProductContext()` permite somente título, descrição, marca, categoria, atributos comerciais e, por opt-in, GTIN. SKU interno, IDs de banco, actor, clientes, pedidos, endereços, telefones, e-mails, pagamentos, cookies, sessões e secrets não entram no contexto. Textos longos são normalizados, truncados em limite de palavra e marcados em `truncatedFields`.

GTIN inicia desabilitado e só deve ser enviado quando a tarefa de identificação justificar. SKU Persi nunca é enviado. Conteúdo de origem é serializado sob `SAFE_PRODUCT_CONTEXT`, separado das system instructions. Web search está desabilitada. Fatos técnicos exigem evidence não derivada apenas de `AI_INFERENCE`; a resposta passa novamente pelo schema Zod local.

## Execução futura

Uma chamada futura exige administrador autenticado, ação e confirmação explícitas, kill switch ligado, provider/model/chave configurados, preço e orçamento explícitos, rate limit e limite de um produto. Abrir/listar/salvar produto, build, prerender, cron e sincronizações não chamam o adapter. A P.3B não conecta o botão ao provider.

O primeiro teste deve usar exclusivamente `scripts/database/pim-ai-dry-run.mjs --synthetic` para preparação. Uma chamada real exige nova fase e autorização. O limite `MAX_REAL_AI_PRODUCTS_PER_RUN=1` não é controlável pelo browser.

## Structured output e metadata

O adapter usa `zodTextFormat` e também valida `output_parsed` com Zod. Metadata preparada: provider, modelo, prompt version, timestamps, duração, tokens e custo estimado. API key, headers e prompt completo não devem ser persistidos ou logados. Auditoria futura deve registrar actor, produto, fingerprint, configuração, status e métricas sem secrets.
