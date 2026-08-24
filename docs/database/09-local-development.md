# Desenvolvimento local — Persi Database Core V1

## Dependências e versões desta implementação

- `drizzle-orm` 0.45.2: DAL tipada server-only;
- `postgres` 3.4.9: driver PostgreSQL, com prepared statements desabilitados para
  compatibilidade com transaction pooling;
- `supabase` CLI 2.115.0: dev dependency reproduzível, requer Node 20+.

Não foi adicionado Drizzle Kit. SQL Supabase é a única fonte de migrations.

## Estrutura

```text
lib/db/
  connection.ts          singleton server-only
  inventory.ts           operação específica de reserva
  money.ts               conversões bigint explícitas
  schema/                 espelho Drizzle por domínio
supabase/
  config.toml             stack local, sem vínculo remoto
  migrations/            SQL oficial e ordenado
  seed.sql                unidades e lista varejo seguras
  tests/database/         pgTAP
scripts/database/         concorrência local
```

## Ambiente

`DATABASE_URL` é usada apenas no runtime Next. Para Supavisor transaction mode,
o driver já usa `prepare: false`; cada processo mantém pool singleton com máximo
cinco conexões. Esse limite deve ser recalculado com o número de instâncias e o
plano antes de produção.

`DIRECT_URL` é exclusiva de migration/dump/restore. O Supabase CLI local não
precisa dessas variáveis para os scripts locais. Nenhuma delas pode ser
`NEXT_PUBLIC_*`.

Hostinger ainda exige confirmar: Node LTS efetivo, processo persistente ou
efêmero, IPv6, quantidade de instâncias, limites de conexão e modo do pooler.
Nenhum deploy foi feito.

## Workflow

1. Instalar com `npm ci` e iniciar Docker.
2. `npm run db:start`.
3. `npm run db:reset:local` para construir banco vazio e aplicar seed.
4. `npm run db:test` para pgTAP, cenários funcionais/Drizzle e concorrência.
5. Alterar schema sempre por nova migration SQL.
6. Atualizar o espelho Drizzle na mesma mudança.
7. Executar toda a validação descrita em `supabase/README.md`.

O reset local é destrutivo para dados locais. Não existe script genérico ou
remoto. `link`, `push` e qualquer staging dependem de autorização futura.

## Decisões concretas

- `gen_random_uuid()` nativo gera PKs. A imagem Supabase local também instala
  `pgcrypto` no schema `extensions`; as migrations da Fase C não dependem dela.
- `unaccent` e `pg_trgm` foram habilitados no schema `extensions` por uso real
  nos campos normalizados/trigram de catálogo/PIM.
- PostgreSQL local está configurado como major 17 pelo CLI inicial. A versão do
  staging deve ser verificada antes de link/aplicação; não assumir igualdade.
- Money e quantidades usam PostgreSQL `bigint`. Drizzle retorna TypeScript
  `bigint`; DTOs serializam como string ou fazem conversão com safe-integer
  check. JSON não serializa `bigint` diretamente.
- Dimensões técnicas usam `numeric` exato e chegam como string; não converter
  implicitamente para float.
- RLS está habilitada sem policies públicas. A aplicação futura usará role
  server-side; Data API não é necessária nesta fase.

## Estoque

As funções `reserve_inventory`, `release_inventory_reservation`,
`confirm_inventory_reservation` e `adjust_inventory` executam mudanças e ledger
na mesma transação. Reserva usa conditional atomic update. Duas instâncias não
conseguem elevar `quantity_reserved` acima de `quantity_on_hand`.

Olist é tratado como fonte futura de `quantity_on_hand` durante a transição via
`adjust_inventory`; reservas continuam separadas. Ajustes abaixo do total
reservado são rejeitados com `adjustment_below_reserved_inventory`, preservando
o saldo anterior e exigindo reconciliação humana. Nenhum job Olist foi criado.

O stress local executa 50 ciclos de duas reservas concorrentes sobre uma unidade
e um burst de dez reservas sobre cinco unidades. Ambos exigem zero overselling.

Em máquinas limitadas a aproximadamente 4 GiB para o Docker, a stack completa
pode falhar no health check. A validação exclusivamente de banco pode iniciar
somente PostgreSQL com `supabase start -x` para os serviços opcionais; API e
Studio ficam indisponíveis nesse perfil, sem alterar migrations ou resultados.

## Categorias e ciclos

O banco bloqueia self-parenting. Ciclos profundos exigem validação transacional
no caso de uso administrativo antes de update; esse caso de uso não pertence à
Fase C. Importação futura também deve detectar ciclos antes da promoção.

## Migrations remotas

O primeiro deploy controlado no `persi-staging` está documentado em
`docs/database/10-staging-deployment.md`. Produção permanece sem deploy automático
de banco e exige autorização própria.
