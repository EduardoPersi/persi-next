# F.4 — Hostinger runtime audit

> F.4.2 parcial (2026-08-26): nenhuma configuração ou mutação foi feita no runtime. `DATABASE_URL` e `DIRECT_URL` permanecem ausentes. A fase parou no Gate A por divergências comerciais do catálogo.

Data da auditoria: 2026-08-24. Estado: **gate incompleto; tráfego PostgreSQL proibido**.

## Evidência confirmada

- O projeto documenta Hostinger Cloud Professional e aplicação Next.js server-side.
- A documentação oficial atual da Hostinger confirma suporte a Next.js e Node 18, 20, 22 e 24 em Cloud Professional, build/deploy gerenciado, runtime logs e botão de restart para aplicações server-side.
- Cloud Professional publicado pela Hostinger: 4 CPU cores, 6 GB RAM, 200 GB de disco e I/O de 40.960 KB/s.
- Web/Cloud hosting permite jobs agendados pelo hPanel. Processos background customizados via SSH não têm a mesma garantia de um VPS; portanto não se deve presumir PM2/systemd.
- O deploy documentado usa GitHub e variáveis server-side. Commit local observado: `79dea8c`, branch `main`.
- O DAL PostgreSQL usa pool singleton, `prepare: false`, máximo de cinco conexões por processo.

Fontes oficiais:

- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/which-server-capabilities-are-supported-at-hostinger/
- https://www.hostinger.com/support/hpanel/cron-jobs/
- https://support.hostinger.com/en/articles/6976044-parameters-and-limits-of-hosting-plans

## Evidência da conta ainda ausente

O ambiente Codex não possui Hostinger Connector, sessão hPanel, API ou SSH autorizado. Não foi possível confirmar na conta real:

- versão Node selecionada;
- build/start commands e diretório efetivo;
- número de processos/instâncias e política de scale/restart;
- limites atuais e consumo de CPU/RAM/processos;
- cron jobs existentes, frequência mínima e mecanismo permitido para Node/HTTP;
- runtime logs e retenção;
- health check/restart automático;
- comportamento de deploy e propagação de environment variables;
- presença de `DATABASE_URL`, `DIRECT_URL`, secrets de webhook/health e flags do canary no runtime.

Localmente existem `APP_BASE_URL`, `CRON_SECRET` e `WORDPRESS_URL`, mas não `DATABASE_URL`/`DIRECT_URL`. Valores não foram exibidos.

## Decisão operacional

Modelo provisório recomendado: **Modelo B — job curto, idempotente e autenticado**, disparado pelo cron do hPanel contra uma rota interna Node. Razões: é a capacidade oficialmente documentada para Cloud hosting e não depende de processo background não comprovado.

Esse modelo só pode ser confirmado depois de verificar no hPanel que o cron pode chamar a aplicação na frequência necessária, que logs ficam disponíveis e que secrets/environment variables propagam após restart. Worker não pode depender de tráfego de usuário.

## Gate para continuar

Fornecer acesso autorizado ao hPanel/Hostinger Connector ou evidência sanitizada das telas de Node.js App, Build settings, Runtime logs, Resource Usage, Environment variables e Cron Jobs. Após isso:

1. registrar configuração e versão implantada;
2. definir/revisar pool por número real de processos;
3. publicar rotas internas com canary ainda 0%;
4. ativar worker/reconciliation e observar uma janela saudável;
5. somente então configurar webhooks Woo e executar Stage 0.

Até o gate ser fechado: worker ativo = não; webhooks = não; reconciliation agendada = não; canary = 0%.
