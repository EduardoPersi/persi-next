# Persi Database — Supabase local

Migrations em `supabase/migrations/` são a fonte oficial do schema. O schema
Drizzle em `lib/db/schema/` apenas as espelha; não usar Drizzle Kit para gerar uma
segunda linha de migrations.

## Pré-requisitos

- Node.js 20 ou superior (usar uma versão LTS aprovada na hospedagem);
- npm;
- Docker Desktop ou runtime compatível em execução;
- dependências instaladas com `npm ci`.

O CLI está fixado como dev dependency e deve ser chamado pelos scripts npm. Não
é necessário instalar Supabase globalmente.

## Comandos locais

```text
npm run db:start
npm run db:status
npm run db:reset:local
npm run db:test
npm run db:stop
```

`db:reset:local` destrói somente o banco local, reaplica migrations e seed. O
nome `:local` e a flag `--local` são obrigatórios. Não criar alias ambíguo
`db:reset`.

Para criar uma migration vazia futura:

```text
npx supabase migration new nome_do_dominio
```

Revise o SQL antes de aplicar. Não executar `supabase link`, `db push`,
`db reset --linked`, dump remoto ou login nesta fase.

## URLs locais

O `config.toml` usa portas padrão do projeto: PostgreSQL `127.0.0.1:54322`, API
`54321` e Studio `54323`. Credenciais locais exibidas pelo CLI são apenas de
desenvolvimento e não podem ser usadas fora da máquina.

## Segurança

- O stack local não tem hardening de produção e não deve ser exposto à rede.
- `.temp/` é ignorado; nenhum project ref remoto deve ser commitado.
- `DATABASE_URL` é runtime server-only; `DIRECT_URL` é migrations/backup.
- Todas as tabelas da Fase C têm RLS habilitada e nenhuma policy pública.
- Nunca copiar dados reais para seed/testes.

## Validação completa

```text
npm run db:reset:local
npm run db:test
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

Os testes pgTAP validam schema/constraints. O teste Node abre duas conexões
locais concorrentes e prova por 50 ciclos que apenas uma reserva consome o
último item; também valida dez tentativas sobre cinco unidades. A validação
funcional cobre PIM, SKU/GTIN, money/pricing, inventory/Olist, mappings e queries
Drizzle reais contra PostgreSQL local.
