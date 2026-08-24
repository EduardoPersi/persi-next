# Deploy controlado — persi-staging

## Escopo e identificação

- Ambiente: Supabase `persi-staging` (`vtrujmhhkmvjzfklzxip`), organização Persi.
- Região: São Paulo.
- Data da execução: 2026-08-23.
- O ambiente estava vazio antes do deploy: nenhuma tabela de domínio, migration ou dado real.
- Produção, WooCommerce, Olist, checkout, pagamentos, DNS e Hostinger não foram acessados nem alterados.

## Backup e recuperação

Antes do deploy, a inspeção da CLI confirmou backups gerenciados por WALG, PITR
desabilitado e nenhum ponto anterior disponível, coerente com o projeto recém-criado.
O staging vazio foi registrado antes da primeira migration. Restore/PITR não foi presumido.

## PostgreSQL e extensões

- PostgreSQL remoto: 17.6; PostgreSQL local validado: 17.6.
- Extensões confirmadas: `pgcrypto`, `pg_trgm` e `unaccent` no schema `extensions`.
  A plataforma também mantém `pg_stat_statements`, `uuid-ossp` e `supabase_vault`.
- Generated columns, triggers diferidos, índices parciais, enums, PL/pgSQL e RLS
  foram aceitos pelo PostgreSQL remoto.

## Deploy e histórico

O dry-run apresentou somente as seis migrations esperadas. O deploy foi feito pelo
Supabase CLI, sem SQL manual no dashboard:

```text
20260823110000_core.sql
20260823110100_catalog.sql
20260823110200_pim.sql
20260823110300_pricing.sql
20260823110400_inventory.sql
20260823110500_external_mappings.sql
```

O histórico remoto reconhece exatamente as seis versões locais.

## Validação estrutural e segurança

- 21 tabelas de domínio, todas vazias após o deploy;
- 64 constraints, 28 índices, 12 funções de domínio e 23 triggers;
- duas generated columns (`sku_normalized` e `quantity_available`);
- RLS habilitada em 21/21 tabelas;
- policies públicas: 0;
- schema estrutural local e staging equivalente para todos os objetos de domínio.

O staging adiciona apenas a função gerenciada `public.rls_auto_enable()`. O dump local
contém grants default de sequence que não existem no remoto. Essas diferenças de plataforma
e permissão não alteram o schema de domínio. A Data API inclui `public` na configuração
padrão, mas RLS sem policies impede acesso por `anon`/`authenticated`; nenhuma policy
permissiva foi criada. A arquitetura continua browser → Next.js → DAL server-side → PostgreSQL.

## Conexão e pooler

Estratégia mantida: conexão direta para migrations e Supavisor transaction pooler para o
runtime, com Postgres.js usando `prepare: false`. A autenticação foi validada em ambos:

- direct connection: PostgreSQL 17.6, conexão inicial aproximada de 310 ms;
- transaction pooler: PostgreSQL 17.6, conexão inicial aproximada de 373 ms;
- dez SELECTs iniciais: direct p50 10 ms/p95 12 ms; pooler p50 12 ms/p95 24 ms.

Drizzle conectou ao PostgreSQL real e validou SELECT, transação, UUID, timestamptz e
`BIGINT → TypeScript bigint`. O pooler aceitou múltiplas requisições e os testes concorrentes
com `prepare: false`, sem timeout ou erro de conexão.

## Testes remotos

- pgTAP: 29/29, 0 falhas, executado em transação com rollback;
- PIM: medida composta e fração imperial exata aprovadas;
- pricing: minor units em bigint e rejeição de períodos sobrepostos aprovadas;
- inventory: reserva, liberação, saldo gerado e ledger aprovados;
- external mappings: identidades entre sistemas e rejeição de duplicidade aprovadas;
- concorrência 2 requisições/1 unidade: 1 sucesso, 1 rejeição, zero overselling;
- concorrência 10 requisições/5 unidades: 5 sucessos, 5 rejeições, zero overselling.

O `db push` não executa `seed.sql`. Para manter o pgTAP remoto autocontido, as unidades
`mm` e `in` são inseridas dentro da transação do teste e removidas pelo rollback. As demais
fixtures usam UUID/tag exclusivos e são apagadas em ordem compatível com as FKs `RESTRICT`.
A auditoria final encontrou zero linhas nas 21 tabelas e zero fixtures marcadas.

## Latência baseline

Vinte amostras por operação, via transaction pooler, sem finalidade de stress:

| Operação | p50 | p95 |
| --- | ---: | ---: |
| SELECT simples | 9,6 ms | 16,9 ms |
| lookup de SKU | 19,2 ms | 43,3 ms |
| product + variant | 19,4 ms | 31,1 ms |
| inventory lookup | 18,9 ms | 32,4 ms |
| transação de reserva | 20,8 ms | 260,8 ms |

O p95 de reserva é apenas baseline de uma amostra pequena e inclui variação de rede/pooler;
não indica overselling ou falha transacional.

## Comandos reproduzíveis

Executar somente depois de confirmar inequivocamente o ref de staging:

```text
npx supabase projects list
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked --yes
npx supabase inspect db table-stats --linked
```

URLs e senhas devem permanecer em variáveis privadas ou arquivos `.env*` ignorados. Nunca
usar prefixo `NEXT_PUBLIC_`. Não configurar a aplicação pública nesta fase.

## Estado atual

Fase D concluída. Deploy, schema, RLS, Drizzle, pooler, testes funcionais, concorrência,
latência e limpeza foram validados no `persi-staging`. Nenhum fixture ou dado real permanece
no remoto. Produção e integrações comerciais não foram alteradas.
