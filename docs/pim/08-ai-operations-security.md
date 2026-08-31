# PIM AI — segurança operacional

## Gates

- Kill switch desligado por padrão em development, test, staging e production.
- Preço desconhecido ou budget ausente bloqueia execução real.
- Output conservador: 1.200 tokens por padrão; timeout de 20 segundos.
- Rate limit inicial: 2 solicitações/minuto no processo administrativo.
- In-flight guard impede duas execuções simultâneas para o mesmo produto/fingerprint.
- SDK configurado com zero retry automático para evitar custo duplicado.
- Erros públicos normalizados: `AI_DISABLED`, `AI_NOT_CONFIGURED`, `AI_RATE_LIMITED`, `AI_BUDGET_EXCEEDED`, `AI_TIMEOUT`, `AI_PROVIDER_ERROR`, `AI_INVALID_RESPONSE`.

O rate limit e o guard em memória protegem a primeira execução controlada em uma instância. Antes de escala ou múltiplas instâncias, devem migrar para coordenação compartilhada no PostgreSQL/Redis com migration e desenho próprios.

## Logging e rollback

Logs podem conter referência segura do produto, provider/model, duração, tokens, status e categoria do erro. Não registrar prompt integral, source data desnecessária, API key, Authorization, ambiente completo ou PII. Desabilitar é imediato: manter/alterar `PIM_AI_ENABLED=false`, remover a credencial do ambiente e reiniciar o runtime. Sugestões já gravadas continuam sob revisão humana e não são publicadas.

## Primeiro teste real futuro

1. Aprovar provider, modelo e preços atuais sem inventar valores.
2. Configurar budget por request, chave server-side e `PIM_AI_ENABLED=true` apenas no ambiente autorizado.
3. Confirmar rate limit, timeout, produto sintético único e zero web search.
4. Exibir confirmação de produto/provider/model/escopo ao administrador.
5. Executar uma chamada, conferir structured output, evidence, tokens e custo.
6. Desligar novamente o kill switch e revisar logs/auditoria.

Produto real, lote de 3.080 itens, aprovação automática e publicação continuam proibidos.
