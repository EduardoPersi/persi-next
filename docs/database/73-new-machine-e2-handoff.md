# E2 handoff para uma nova maquina

## Checkpoint

- Branch: `checkpoint/native-commerce-b3c-e2-20260908`
- Projeto: Persi Next
- Node.js: usar uma versao LTS compativel com as dependencias registradas em `package-lock.json` (o projeto ainda nao declara `engines` no `package.json`).
- PostgreSQL local esperado: 17.6.
- O ambiente local deve seguir `supabase/config.toml`, `supabase/README.md` e os scripts versionados do projeto.

O Docker VHDX da maquina anterior nao e necessario para reconstruir o ambiente. Use um ambiente Docker/Supabase novo e saudavel e reconstrua o banco exclusivamente pelas migrations do repositorio.

## Cadeia de migrations

- Quantidade esperada: 31 migrations.
- Ultima migration: `20260907180000_native_checkout_submission_authority_null_safe.sql`.
- M32: ausente.

Artefatos congelados:

- M29: `09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`
- M30: `db393c838157b3581eb269042835ace265b97be86f34f840f69ecf9436d1ed6c`
- M31: `f09bb724a0afd729771945b0ca264678629d1edf801d1bfb792ed416068e21f2`
- E1 harness: `51c0e64bb4f7d0ebf56cf36e38609330d253518fc7e223674e8c7bf9b8f77183`
- E2 harness: `59fb44554ed794d3d989814a6041f2fe079b426e36bd68d41cb113b5b84e3a45`
- E2 helper: `a3e32e84bfbb54e697a7ad219907ad120648aa3e741b13adfb69eee2f65a2c4c`

Revalide esses hashes antes de executar a proxima fase.

## Evidencia E2 preservada

- Self-test: PASS.
- Familias A-H: PASS.
- Ciclos de familia: 16.
- Operacoes: 161.
- Tentativas nao autorizadas: 4.
- Sucessos nao autorizados: 0.
- Criacoes nao autorizadas: 0.
- Recuperacoes nao autorizadas: 0.
- Sucessos nao autorizados indeterminados: 0.
- Funcional: 65/65.
- Double-submit: 20/20.
- Divergent-hash: 20/20.

Essa evidencia pode ser carregada como historico, mas nao substitui os testes pendentes abaixo.

## Trabalho E2 pendente

Na nova maquina, executar em ambiente local descartavel e saudavel:

1. pgTAP completo, baseline 17 arquivos e 534/534 assercoes.
2. Concorrencia de carrinho: 20 ciclos por 3 familias.
3. Concorrencia de checkout: 20 ciclos por 6 familias e matriz de 220 operacoes.
4. Regressao E1 pequena.
5. `npm test`.
6. Typecheck.
7. Lint.
8. Build offline.
9. Somente apos os gates anteriores, E2-HQ.
10. Somente apos E2-HQ, E2 Final.

Nao herdar como aprovados os resultados descartaveis cuja saida nao ficou auditavel no host anterior.

## Incidente da maquina anterior

Classificacao: `HOST_DISK_CONTROLLER_ERROR_AFFECTING_DOCKER_VHD`.

O host anterior apresentou instabilidade fisica intermitente no armazenamento que continha o VHDX do Docker. Nao reutilize nem trate o VHDX antigo como requisito para continuar E2. Antes de qualquer qualificacao, confirme a saude do armazenamento da nova maquina e crie um ambiente local novo.

## Segredos e ambientes externos

- Configure credenciais manualmente em arquivos locais ignorados pelo Git.
- Use `.env.example` apenas como lista de nomes e placeholders.
- Nao copie arquivos `.env*`, certificados privados, dumps ou estado Docker da maquina anterior.
- Nao acesse staging ou producao durante a reconstrucao e validacao local.
