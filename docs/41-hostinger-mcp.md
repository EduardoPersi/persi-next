# 41 — MCP oficial da Hostinger

Configuração do servidor MCP oficial da Hostinger para uso por agentes de IA
(Claude Code e clientes compatíveis). Escopo: leitura e operação do plano de
hospedagem e da instalação WordPress/WooCommerce. Não altera nada da aplicação
Next.js em runtime.

## O que foi configurado

`.mcp.json` na raiz do repositório declara dois servidores, ambos do pacote
oficial `@hostinger/mcp` (MIT, repositório `hostinger/api-mcp-server`):

| Servidor | Binário | Ferramentas | Uso |
| --- | --- | --- | --- |
| `hostinger-hosting` | `hostinger-hosting-mcp` | 73 | plano de hospedagem, deploys de aplicação JS, logs de runtime, cache, cron jobs |
| `hostinger-wordpress` | `hostinger-wordpress-mcp` | 38 | instalação WordPress de `loja.persimateriais.com.br` |

O pacote traz outros binários que não foram habilitados por já não pertencerem
ao escopo atual ou por custo de contexto: `hostinger-dns-mcp` (8),
`hostinger-domains-mcp` (41), `hostinger-vps-mcp` (64),
`hostinger-ecommerce-mcp` (29), `hostinger-mail-mcp` (38),
`hostinger-billing-mcp` (9), `hostinger-reach-mcp` (52),
`hostinger-horizons-mcp` (6), `hostinger-agency-hosting-mcp` (38) e o unificado
`hostinger-api-mcp` (396). Para habilitar um deles, acrescentar uma entrada em
`.mcp.json` com o mesmo formato.

A versão está fixada (`@1.61.1`) para evitar mudança silenciosa de
comportamento. Para atualizar, trocar a versão nos dois `args` e revalidar.

## Credencial

O token nunca fica no repositório. Os servidores leem `HOSTINGER_API_TOKEN` do
ambiente, expandido por `${HOSTINGER_API_TOKEN}` no `.mcp.json`.

1. Gerar o token no hPanel da Hostinger, em **Conta → API**, com o menor escopo
   que atenda ao uso pretendido.
2. Definir `HOSTINGER_API_TOKEN` no ambiente:
   - local: variável de ambiente do shell ou do gerenciador de segredos da
     máquina — não usar `.env.local` do Next, que não alimenta o MCP;
   - Claude Code na web: nas variáveis de ambiente do environment remoto.
3. A variável precisa existir **antes** de a sessão iniciar.

## Rede

A API não fica em `api.hostinger.com`. O pacote chama
`https://developers.hostinger.com` (e `https://api.mail.hostinger.com` nas
ferramentas de e-mail). Em ambiente com egresso restrito — Claude Code na web
usa allowlist por domínio — é esse host que precisa ser liberado, senão a
chamada falha com `request blocked: no rule or allowlist entry allows host
"developers.hostinger.com"` mesmo com o token correto.

Mínimo a liberar:

```text
developers.hostinger.com
```

Sem a variável, os servidores sobem mesmo assim e caem no fluxo OAuth do
navegador na primeira chamada autenticada — o que não funciona em sessão
remota, sem navegador. Na prática: sem token, sem acesso.

## Alternativa hospedada

A Hostinger também publica um servidor MCP remoto em `https://mcp.hostinger.com`
(Streamable HTTP, com OAuth). É a opção adequada para quem prefere configurar um
conector em `claude.ai` no lugar de um servidor local com token. As duas formas
são equivalentes em ferramentas; a diferença é onde a credencial vive.

## Limites operacionais

Continuam valendo as regras do `AGENTS.md` (§34): alterar configuração de
produção, Hostinger, Cloudflare ou DNS exige autorização explícita. O acesso via
MCP é usado por padrão em modo leitura e auditoria. Operações de escrita —
deploy, restart, limpeza de cache, criação de cron — só mediante pedido direto.

Referências de contexto: `docs/database/21-hostinger-runtime.md` e
`docs/database/23-hostinger-runtime-audit.md`.
