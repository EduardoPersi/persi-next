# B.3-C3-P3-C — Integrated C3 prerequisite validation

Data: 2026-09-04. Resultado: hard stop no preflight, antes da criação do harness integrado.

## Integridade da baseline

- P3-A: `20260904010000_secure_checkout_pii_foundation.sql`
- SHA-256 esperado e obtido: `a4ae5198f74af785154ba6275d3631be1950616c7a2a34425f168a240e8ab32d`
- P3-B: `20260904050000_native_checkout_order_integrity_hardening.sql`
- SHA-256 esperado e obtido: `12aabf11350cf0b3b58d886994b4daa127aac59e8f694fb42f5c41a3433d3459`

## Bloqueio real encontrado

O schema C2 oferece `orders.tax_id_type`, `tax_id_ciphertext`, `tax_id_fingerprint` e `tax_id_masked`, mas a aplicação não possui um helper server-only capaz de transformar o CPF/CNPJ temporário, depois da autenticação do envelope P3-A, em uma representação criptográfica durável e independente.

`assertEncryptedTaxIdBundle` somente verifica presença de campos e formato hexadecimal do fingerprint. Ele não produz nem autentica ciphertext, não cria nonce próprio, não define purpose/AAD durável, não incorpora versionamento ou key ID, não calcula HMAC domain-separated e não demonstra decrypt/rotation. Dessa forma, ele não prova a fronteira exigida para C3 e aceitaria um ciphertext arbitrário.

Reutilizar `pii_ciphertext` seria incorreto: esse ciphertext cobre o envelope temporário inteiro e está vinculado por AAD ao checkout. Reutilizar diretamente `encryptCheckoutPii` também seria incorreto, pois seu purpose, payload e ciclo de vida são temporários. O requisito P3-C exige nonce e purpose distintos para o documento fiscal durável.

Classificação:

- `P3C_BLOCKER_FOUND = YES`
- tipo: application security prerequisite ausente;
- impacto: C3 não pode criar com segurança o snapshot fiscal durável;
- schema novo automaticamente necessário: não demonstrado;
- migration criada: não;
- workaround aplicado: não.

O campo texto existente pode, em princípio, armazenar um envelope autocontido e versionado contendo key ID, nonce, tag e ciphertext. Isso precisa ser definido e validado em uma fase corretiva explícita antes de repetir P3-C. Caso a implementação aprovada conclua que esses metadados devem ser colunas independentes, essa decisão estrutural deverá gerar migration própria, nunca uma alteração silenciosa nesta fase.

## Validações não executadas após o hard stop

Por determinação do requisito 27, não foram criados harness, fixtures, pedidos sintéticos ou ciclos integrados. Portanto permanecem não validados nesta execução: PII/address/quote binding integrado, price revalidation integrada, reservation/order linkage end-to-end, idempotência C3 simulada, rollback early/mid/late, stock=1/2/contention, 50 ciclos de deadlock, error matrix executável, client authority e public projection integrados.

As evidências isoladas aprovadas em P3-A e P3-B continuam válidas, mas não são promovidas a aprovação integrada P3-C.

## Contrato corretivo mínimo antes de repetir P3-C

Uma fase offline e explicitamente autorizada deve implementar e testar um helper server-only para documento fiscal durável com:

1. entrada canônica validada (`cpf` ou `cnpj` e somente dígitos);
2. AES-256-GCM com nonce novo por documento;
3. purpose/AAD distintos do envelope temporário, vinculando ao menos store/order context e versão;
4. formato versionado e key ID para decrypt e rotação;
5. fingerprint HMAC-SHA-256 domain-separated com chave server-only;
6. máscara derivada do valor canônico;
7. decrypt autenticado, tamper/unknown-key/version failures fechados;
8. nenhuma persistência ou log de plaintext;
9. testes que provem que o ciphertext do checkout não é reutilizado.

Depois dessa correção, P3-C deve reiniciar pelo hash gate, rebuild das 25 migrations e pgTAP completo, antes do harness integrado.

## Operações remotas

Não houve conexão ou escrita em staging nesta execução. P3-A e P3-B não foram aplicadas. Produção, WooCommerce, Olist, pagamentos, frete, PIM e runtime nativo permaneceram inalterados. Não houve commit ou push.

## Restart após P3-C0-TAX — novo bloqueio de contrato

O restart independente confirmou os hashes P3-A/P3-B e a contagem de 25 migrations. O bloqueio fiscal foi considerado resolvido apenas como pré-requisito isolado; nenhum gate integrado foi herdado.

Antes da execução do harness, a auditoria do cenário crítico stock=1 encontrou incompatibilidade entre o requisito P3-C e o contrato de inventory vigente:

- P3-C exige `inventory movements = 0 before payment confirmation` depois de uma das duas reservas concorrentes ser criada;
- `public.reserve_inventory` incrementa `quantity_reserved`, cria a reserva e insere obrigatoriamente um ledger row em `inventory_movements` com `movement_type = 'reservation'`, tudo na mesma transação;
- o pgTAP canônico `core_catalog_pim_pricing_inventory.test.sql` exige explicitamente `reservation writes ledger movement`;
- a validação geral também considera os movimentos `reservation`, `release` e `sale` parte do contrato oficial.

Logo, um teste real não pode satisfazer simultaneamente os dois contratos. Suprimir ou ignorar o ledger para obter zero movimentos esconderia comportamento real e enfraqueceria a auditabilidade do estoque.

Classificação deste restart:

- `P3C_BLOCKER_FOUND = YES`;
- `P3C_BLOCKER_CODE = INVENTORY_RESERVATION_LEDGER_CONTRACT_CONFLICT`;
- tax integrado: não executado e não herdado;
- migration criada: não;
- schema alterado: não;
- workaround: não.

A decisão semântica foi posteriormente confirmada: “movements = 0” significava ausência de baixa física/`sale` antes do pagamento. O movimento contábil append-only `reservation` continua obrigatório. O item foi reclassificado como `TEST_CONTRACT_CORRECTION`, não como bloqueio de arquitetura; nenhuma migration ou alteração em `reserve_inventory` é necessária.

### Restart após a correção do ledger

No restart seguinte, Docker Engine 29.7.2 respondeu inicialmente e o PostgreSQL Supabase foi iniciado com serviços auxiliares excluídos. `supabase db reset --local` falhou antes da aplicação das migrations com `LegacyDbSetupError: error running container: exit 125`. Logo depois, `docker info` voltou a retornar HTTP 500 na API `dockerDesktopLinuxEngine/v1.55/info`.

Conforme o roteiro autorizado, a execução parou com `P3C_OPERATIONAL_BLOCKER = DOCKER_UNAVAILABLE`. Não houve cleanup destrutivo, remoção de volume/imagem, alteração de schema, harness executado ou promoção de gate integrado. O próximo restart deve começar novamente por hashes, contagem, health check, rebuild e pgTAP.

## Recuperação operacional local de 2026-09-04

A recuperação não destrutiva confirmou Windows 10 Pro build 19045, WSL 2.7.12.0 com kernel 6.18.33.2 e Docker Desktop 4.87.0 / Engine 29.7.2 no contexto esperado `desktop-linux`. Não havia override por `DOCKER_HOST` ou `DOCKER_CONTEXT`. O host apresentava 11,25 GB livres em C: e 294,75 GB em D:. O PostgreSQL local era o único container, usando a porta 54322 sem colisão externa, e estava inicialmente `healthy`.

Os gates anteriores ao reset passaram:

- 25 arquivos de migration;
- P3-A SHA-256 `a4ae5198f74af785154ba6275d3631be1950616c7a2a34425f168a240e8ab32d`;
- P3-B SHA-256 `12aabf11350cf0b3b58d886994b4daa127aac59e8f694fb42f5c41a3433d3459`;
- PostgreSQL aceitando conexões;
- nenhum volume, imagem ou distribuição WSL removido.

A única tentativa autorizada de `supabase db reset --local` avançou por `Resetting local database`, `Recreating database` e parou em `Initialising schema` com `LegacyDbSetupError: error running container: exit 125`. Imediatamente depois, `docker version` deixou de responder e expirou. Os logs locais do Docker Desktop registraram respostas HTTP 500 da API `dockerDesktopLinuxEngine` e falha de acesso ao daemon; não houve OOM, erro do container PostgreSQL ou evidência de falha em migration SQL.

Foi realizado um reinício controlado: fechamento do Docker Desktop, encerramento dos processos remanescentes, `wsl --shutdown` e inicialização normal. A engine voltou a responder com `docker version`, `docker info` e `docker ps`; o PostgreSQL retornou `healthy`, sem restart e aceitando conexões. Entretanto, o banco recriado permaneceu vazio, com zero tabelas públicas e sem `supabase_migrations.schema_migrations`. Portanto:

- `DOCKER_ENGINE_HEALTHY = YES` ao final da recuperação;
- `WSL_HEALTHY = YES`;
- `LOCAL_POSTGRES_HEALTHY = YES` apenas no nível do processo/health check;
- `LOCAL_25_MIGRATIONS_REBUILD_PASS = NO`;
- `PGTAP_PASS = NO` (não executável sem schema reconstruído);
- `P3C_OPERATIONAL_BLOCKER_RESOLVED = NO`;
- `SAFE_TO_RESUME_P3C = NO`.

Nenhuma segunda tentativa de reset foi feita. Nenhum cleanup destrutivo, acesso remoto, commit ou push ocorreu. A menor intervenção seguinte é diagnosticar/reparar a instabilidade do daemon/container runtime do Docker Desktop sem apagar o volume local; somente depois deve ser autorizada uma nova reconstrução local.

## P3-C-OPS-D2 — causa raiz do exit 125

O diagnóstico P3-C-OPS-D2 preservou o estado e testou o runtime antes de permitir uma única nova tentativa de reset. O Docker Engine 29.7.2 passou em 10/10 criações sequenciais de containers efêmeros, 5/5 criações concorrentes, 10/10 comandos `docker exec` e aproximadamente 315 segundos de soak com `docker info`, `docker ps` e `pg_isready`. Não houve exit 125, HTTP 500, timeout ou OOM nesses gates.

As observações de recursos mostraram:

- Windows com aproximadamente 8 GB de RAM física e menos de 1 GB disponível durante parte do diagnóstico;
- Docker/WSL limitado a aproximadamente 3,73 GiB, com cerca de 3 GiB disponíveis internamente durante a medição;
- pagefile ativo e sem evidência de OOM;
- C: com 21,76 GB livres e D: com 294,76 GB livres;
- VHD de dados Docker em D: com 9,09 GB e volume PostgreSQL com aproximadamente 66 MB;
- nenhuma evidência de pressão de disco, VHD, mount, imagem ou rede bridge interna.

A inspeção offline da Supabase CLI 2.115.0 confirmou que `Initialising schema` no PostgreSQL 17 executa containers efúmeros de setup para serviços habilitados (Realtime, Storage e Auth), na rede Supabase e sem bind mounts. Os logs históricos do Docker registraram perda de comunicação com o daemon por `context deadline exceeded` e HTTP 500, mas o container efúmero original já havia sido removido e não foi possível atribuir aquele exit 125 a uma das três imagens com certeza.

Depois de todos os gates de estabilidade passarem, a única tentativa autorizada de `supabase db reset --local --debug` falhou antes de `Initialising schema`, durante a recriação do PostgreSQL. O daemon recusou publicar `0.0.0.0:54322` com erro de permissão de socket. O container `supabase_db_persi-next` ficou em estado `Created`, configurado para mapear `54322` para `5432`, sem evento `start` e sem OOM.

A auditoria do host provou que não havia listener em 54322. O Windows mantinha, para IPv4 e IPv6, uma faixa excluída TCP de 54293 a 54392, que inclui as portas locais Supabase 54320, 54321, 54322, 54323, 54324 e 54327. A causa raiz primária foi classificada como `H. DOCKER_NETWORK_FAILURE`, subtipo `WINDOWS_HOST_PORT_EXCLUSION`, com alta confiança. Essa evidência substitui a hipótese anterior de simples colisão por processo: a porta estava livre de listeners, mas indisponível para bind por reserva do sistema operacional.

Nenhuma segunda tentativa foi feita e nenhuma faixa excluída do Windows foi removida. A faixa 15420–15429 foi confirmada livre e abaixo do intervalo dinâmico do host, mas a porta 54322 também está codificada em vários scripts de validação. Alterar somente `config.toml` criaria inconsistência; alterar configuração e scripts estava fora do escopo desta fase. A correção mínima recomendada para uma fase autorizada é migrar coordenadamente as portas locais Supabase para 15420–15429 e centralizar a URL local, sem tocar em staging ou produção.

Resultado:

- `DOCKER_INFO_STABLE = YES`;
- `GENERIC_CONTAINER_CREATE_PASS = YES`;
- `GENERIC_CONTAINER_CONCURRENCY_PASS = YES`;
- `DOCKER_EXEC_PASS = YES`;
- `NO_HTTP_500_DURING_SOAK = YES`;
- `ROOT_CAUSE_IDENTIFIED_OR_STRONGLY_MITIGATED = YES`;
- `RESET_GATE_PASS = YES`;
- `LOCAL_DB_RESET_PASS = NO`;
- `LOCAL_25_MIGRATIONS_REBUILD_PASS = NO`;
- `PGTAP_PASS = NO`;
- `P3C_OPERATIONAL_BLOCKER_RESOLVED = NO`;
- `SAFE_TO_RESUME_P3C = NO`.

Não houve limpeza destrutiva, alteração de migrations/schema/código/configuração, acesso remoto, commit ou push.

## P3-C-OPS-D3 — remapeamento local e rebuild aprovado

A fase P3-C-OPS-D3 corrigiu de forma coordenada o bloqueio `WINDOWS_HOST_PORT_EXCLUSION`. A família local Supabase foi remapeada de 54320–54329 para 15420–15429, preservando a semântica de cada serviço. A porta PostgreSQL mudou de 54322 para 15422; a porta interna do container permaneceu 5432. A nova faixa foi confirmada livre, única, abaixo do range dinâmico do Windows e fora das exclusões TCP.

As conexões locais antes duplicadas foram centralizadas em `scripts/database/local-database.mjs`. O resolvedor aceita `PERSI_LOCAL_DATABASE_URL` apenas para hosts loopback, oferece default exclusivamente local fora de produção e falha fechado em `NODE_ENV=production` quando não há configuração explícita. Nenhuma variável `NEXT_PUBLIC_*`, fallback remoto para localhost ou alteração de configuração de staging/produção foi introduzida. A auditoria posterior encontrou zero dependências ativas de 54320–54329; as ocorrências restantes pertencem apenas ao histórico do diagnóstico.

O container local em estado `Created` foi reconciliado por `supabase stop` sem `--no-backup`; o volume `supabase_db_persi-next` foi preservado. A stack mínima foi reiniciada com apenas PostgreSQL e publicou corretamente `0.0.0.0:15422 -> 5432/tcp`. O container ficou `healthy`, `pg_isready` passou e uma conexão TCP pelo helper confirmou o banco `postgres` e a porta interna 5432. A porta antiga 54322 deixou de ser necessária e não possuía listener.

O hash gate permaneceu intacto:

- arquivos de migration: 25;
- P3-A: `a4ae5198f74af785154ba6275d3631be1950616c7a2a34425f168a240e8ab32d`;
- P3-B: `12aabf11350cf0b3b58d886994b4daa127aac59e8f694fb42f5c41a3433d3459`.

A única execução autorizada de `supabase db reset --local` passou. O schema inicial foi criado, as 25 migrations foram aplicadas em ordem, `supabase/seed.sql` foi executado e os containers foram reiniciados. O histórico registrou exatamente 25 migrations, de `20260823110000` a `20260904050000`, sem migration 26. O schema público apresentou 52 tabelas e todas as fundações esperadas foram encontradas: stores, customers, carts, checkout sessions/items/quotes, orders/items/addresses/adjustments/status events, inventory reservations e store price-list assignments.

O pgTAP completo passou com 13 arquivos e 452/452 testes. As regressões representativas também passaram:

- database/Drizzle/PIM/SKU/GTIN/money/pricing/inventory/external mappings: aprovado;
- price history single-writer: aprovado;
- inventory: 50 ciclos, 50 sucessos, 50 rejeições esperadas e zero overselling;
- native cart: 20 ciclos, zero falhas;
- native checkout: 20 ciclos, 220 execuções, zero falhas e zero overselling;
- native order: 20 ciclos, 360 execuções, zero duplicidade/lost update/falha.

Após reset e testes, Docker 29.7.2 continuou respondendo, o único container permaneceu `healthy` em 15422 e `pg_isready` passou. O host tinha aproximadamente 961 MB de RAM física disponível; o PostgreSQL consumia cerca de 91 MiB e não houve OOM, HTTP 500, exit 125 ou timeout. A baixa memória livre permanece observação operacional, não bloqueio desta fase.

Resultado final:

- `WINDOWS_PORT_EXCLUSION_CONFIRMED = YES`;
- `NEW_LOCAL_PORT_RANGE_SAFE = YES`;
- `LOCAL_PORT_MAP_UPDATED = YES`;
- `ACTIVE_54322_HARDCODES_REMOVED = YES`;
- `LOCAL_DB_CONFIG_CENTRALIZED = YES`;
- `LOCAL_DB_RESET_PASS = YES`;
- `LOCAL_25_MIGRATIONS_REBUILD_PASS = YES`;
- `PGTAP_PASS = YES`;
- `POST_RESET_DOCKER_STABLE = YES`;
- `P3C_OPERATIONAL_BLOCKER_RESOLVED = YES`;
- `SAFE_TO_RESUME_P3C = YES`.

## Fixture isolation remediation concluida

Em 2026-09-05, a fase local/offline P3-C-FIXTURE-ISO resolveu o blocker de
contaminacao entre validadores. Um unico reset reconstruiu as 25 migrations; T0, T1 e
T2 passaram com 452/452 assertions. Dois ciclos completos consecutivos, sem reset entre
eles, preservaram `S2 = S1 = S0`, e os quatro testes de failure injection falharam de
forma controlada mantendo o baseline. Detalhes e evidencias estao em
`docs/database/42-native-commerce-b3c3-p3c-integrated-validation.md`.

O blocker operacional de fixture isolation esta resolvido, mas nenhum gate integrado
P3-C foi executado ou herdado. O proximo passo permitido e reiniciar P3-C desde o hash
gate. Staging, producao e runtime permaneceram intocados.

Nenhum acesso remoto, limpeza destrutiva, commit ou push ocorreu. O harness integrado P3-C não foi iniciado.

## Restart final P3-C — fixture isolation blocker

O restart final confirmou novamente 25 migrations, hashes P3-A/P3-B e PostgreSQL local saudável em 15422. Entretanto, o pgTAP pré-harness falhou porque regressões da fase D3 deixaram fixtures sintéticas persistidas e alguns testes pgTAP fazem assertions globais. Conforme o hard stop, nenhum reset corretivo, harness ou acesso a staging foi executado. O diagnóstico completo está em `docs/database/42-native-commerce-b3c3-p3c-integrated-validation.md` com `P3C_BLOCKER_FOUND = YES` e código `LOCAL_VALIDATION_FIXTURE_ISOLATION_FAILURE`.
