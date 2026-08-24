# Backup e recovery — requisitos

## Escopo e ressalva

Este documento define metas, não afirma recursos contratados. O plano Supabase,
região, retenção de backups, Point-in-Time Recovery, export, criptografia e SLA
devem ser verificados no dashboard/documentação vigente antes da produção. A
documentação geral informa backups gerenciados e PITR em planos elegíveis, mas a
disponibilidade concreta da Persi não foi auditada.

Fonte de referência: [Supabase Database overview](https://supabase.com/docs/guides/database/overview).

## Classes e metas arquiteturais recomendadas

| Ambiente/dado | RPO target | RTO target | Observação |
| --- | --- | --- | --- |
| Local | não aplicável | 4 h | reconstruir migrations + seeds seguros |
| Staging | 24 h | 8 h | dados anonimizados/reimportáveis |
| Production catálogo/PIM | 4 h | 4 h | recuperável também de fontes/mappings, mas não depender disso |
| Production pedidos/pagamentos/estoque | <= 15 min | <= 2 h | meta sujeita a plano/PITR e teste real |

RPO/RTO finais exigem aprovação comercial, financeira e verificação de custo.

## Estratégia

- Migrations Git constroem schema vazio; seed contém apenas dados estruturais.
- Backup gerenciado do provider é primeira camada, se confirmado.
- Export lógico periódico cifrado para local independente/conta separada é
  segunda camada, com acesso restrito e retenção definida.
- PITR, se contratado, cobre erro/corrupção recente; não substitui export nem
  proteção contra credencial comprometida.
- Mídia/storage, secrets, configurações de auth e integrações têm plano próprio;
  `pg_dump` não os cobre necessariamente.
- External mappings, inbox/outbox, audit e order snapshots são prioritários no
  recovery por preservarem reconciliação e histórico.

## Procedimento de restore

1. declarar incidente, congelar writes/workers e registrar recovery point;
2. preservar evidências/logs e confirmar escopo/autoridade atual;
3. criar destino isolado, nunca sobrescrever production na primeira tentativa;
4. restaurar schema/extensões/roles e dados com conexão direta;
5. validar migrations, constraints, contagens, checksums e amostras financeiras;
6. reconciliar Woo/Olist/PSPs desde o recovery point usando inbox/APIs;
7. executar smoke/read-only e testes de segurança/RLS;
8. obter aprovação e fazer cutover controlado;
9. reabrir workers por ordem, observar backlog e documentar incidente.

Pagamentos recebidos após o recovery point devem ser reconsultados no provider;
não recriar cobranças. Pedidos/estoque exigem reconciliação antes de liberar
writes para evitar duplicidade/overselling.

## Testes

- Local: reset do zero em cada mudança de migration relevante.
- Staging: restore trimestral recomendado para ambiente isolado.
- Production futura: exercício semestral ou após mudança material de plano/schema.
- Medir RPO real, RTO real, integridade, runbook, acessos e gaps. Backup não
  testado não é considerado recuperável.

## Segurança e retenção

- Dumps cifrados em trânsito/repouso; acesso MFA/least privilege; checksums.
- Nunca incluir secrets em dump/fixtures/documentação.
- Retenção alinhada a LGPD e obrigações fiscais; cópias expiradas são eliminadas
  de forma verificável.
- Restore de production para staging exige anonymização antes do acesso amplo.
- Logs de backup não imprimem connection string nem PII.

## Itens a verificar no Supabase

- tier/compute, região e conectividade direta IPv6/IPv4;
- frequência/retenção do backup gerenciado e granularidade de restore;
- PITR, janela disponível, processo e custo;
- backups de Storage/Auth/configuração além do PostgreSQL;
- limites de dump/restore e extensões;
- responsabilidades compartilhadas, suporte e SLA;
- método de export independente e teste sem afetar staging conectado.

## Proteção contra alvo errado

Comandos de reset/drop/restore exigem environment explícito, host/project ref
allowlisted e confirmação. Production não é default e nunca aceita reset
automatizado. Credencial de migration fica fora do runtime. Restore destrutivo
somente após aprovação humana, backup validado e destino resolvido.
