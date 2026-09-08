# B.3-C3-P3-C-M29-P0B — native cart authority hardening design

## Implementação candidata A2/B2 (2026-09-05)

`20260905180000_native_checkout_atomic_submission.sql` implementa policies
SELECT-only, revogação de DML app/worker, funções v2 `SECURITY DEFINER` owner
`postgres` com `search_path` vazio, owner check, parent-cart lock, guards de estado,
versão e item, e remoção dos overloads antigos. A prova runtime fica para M29-C/E1.

Data: 2026-09-05. Escopo local, offline e estritamente read-only. Nenhuma migration,
função, policy, fixture ou alteração persistente foi criada.

## Resultado

O blocker `M29_IMPLEMENTATION_CONTRACT_MISMATCH` foi confirmado e possui correção de
design determinística. O alvo recomendado é **revogação de DML + funções estreitas
SECURITY DEFINER + triggers estruturais**. O hardening deve abrir a futura migration 29
antes da primitiva de submissão, mantendo uma única atualização coerente. Migration 30
não é necessária.

## Baseline

- PostgreSQL `17.6` em `127.0.0.1:15422`;
- 28 arquivos e 28 registros, última `20260905130000`;
- migration 29 e migration 30 ausentes;
- migrations protegidas 24–28 inalteradas;
- migration 28: `7d938dc2578aef9fac8c82058ea2a3dd7280546a9de0e9e52f6cd9cd3a39d45c`.

## Autoridade atual

`carts` e `cart_items` pertencem a `postgres`, têm RLS habilitada e não forçada.
`persi_app` e `persi_worker` possuem policies `FOR ALL` com `USING(true)` e
`WITH CHECK(true)`.

Grants atuais:

| Role | carts | cart_items |
|---|---|---|
| `persi_app` | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE, DELETE |
| `persi_worker` | SELECT, INSERT, UPDATE | SELECT, INSERT, UPDATE, DELETE |
| public/browser/readonly | sem DML | sem DML |

Os únicos triggers são `carts_set_updated_at` e `cart_items_set_updated_at`. Não há
guard de transição de status, mutabilidade de identidade ou mutabilidade de item.

Primitivas B3-B:

- `add_native_cart_item(uuid,uuid,bigint)`;
- `set_native_cart_item_quantity(uuid,uuid,bigint)`;
- `remove_native_cart_item(uuid,uuid)`;
- `merge_native_carts(uuid,uuid,uuid)`.

As quatro são `SECURITY INVOKER`, owner `postgres`, volatile, `search_path=public` e
executáveis por app e worker. Add/set/remove bloqueiam o parent cart, exigem `active`,
mutam item e incrementam version. Merge bloqueia ambos os carts em ordem por ID,
exige ambos `active`, soma itens, marca a origem `merged`, elimina o guest fingerprint
e incrementa as duas versões.

`prepare_native_checkout` e `close_native_checkout` são `SECURITY DEFINER`, search
path vazio. A primeira executa `active → locked` com `version + 1`; a segunda libera
reservas e executa `locked → active` com `version + 1` em checkout cancelado/expirado.

## Chamadores

Não foi encontrado chamador de produção, admin ou worker realizando DML nativo direto.
`lib/db/nativeCart.ts` contém somente token/fingerprint e autorização em memória; ainda
não possui repository de persistência. Usos diretos estão em scripts de banco,
concorrência, fixture setup/cleanup e pgTAP, executados pela role local privilegiada.
Eles não justificam grants inseguros ao runtime.

Não há evidência de job legítimo de `persi_worker` para criar ou editar carrinho. O
worker conserva somente a execução já aprovada de `close_native_checkout`; lifecycle
adicional de abandono/expiração deve receber função própria quando existir requisito.

## Modelo alvo

### Grants e RLS

- revogar INSERT/UPDATE/DELETE em `carts` e `cart_items` de app e worker;
- substituir policies `FOR ALL` por policies explícitas de SELECT;
- manter browser, public e readonly sem mutação;
- conceder EXECUTE somente nas funções adequadas a cada role;
- não devolver DML para preservar funções invoker.

### Segurança das funções

As primitivas aprovadas devem ser `SECURITY DEFINER`, owner `postgres`, com
`SET search_path=''`, objetos totalmente qualificados, sem SQL dinâmico, EXECUTE
público/browser revogado e owner check interno. UUID não é autorização.

Assinaturas v2 devem incluir contexto de owner:

- `create_native_cart(store,customer,guest_fingerprint,currency,expires_at)`;
- `add_native_cart_item(cart,customer,guest_fingerprint,variant,quantity)`;
- `set_native_cart_item_quantity(cart,customer,guest_fingerprint,variant,quantity)`;
- `remove_native_cart_item(cart,customer,guest_fingerprint,variant)`;
- `merge_native_carts(guest_cart,customer_cart,customer,guest_fingerprint)`.

Os overloads antigos deixam de ter EXECUTE e devem ser removidos após atualização dos
testes/callers. `create_native_cart` sempre cria `active`, valida store ativa, moeda,
expiração e XOR customer/guest. Para retry, usa as unicidades existentes de guest
fingerprint e active customer por store/currency, retornando somente identidade
coerente.

App pode criar e alterar carts somente por essas funções. Worker não recebe essas
funções. Lock, unlock e convert não são APIs genéricas: preparação do checkout,
fechamento do checkout e futura submissão são suas únicas autoridades.

## Máquina de estados

Matriz aprovada com evidência atual:

| From | To | Permitido | Autoridade |
|---|---|---:|---|
| active | locked | sim | `prepare_native_checkout` |
| active | merged | sim | `merge_native_carts` |
| locked | active | sim | `close_native_checkout`, após release |
| locked | converted | sim | futura `submit_native_checkout` |
| qualquer outro par | — | não | — |

`converted`, `merged`, `expired` e `abandoned` são terminais neste contrato. Não há
hoje fluxo aprovado que produza abandoned/expired diretamente no cart; uma futura
necessidade exige nova função e revisão explícita da matriz. Isso evita inventar
recovery sem evidência.

Classificação de colunas:

- `id`, `store_id`, `currency`, `created_at`: imutáveis após criação;
- `customer_id` e `guest_token_fingerprint`: imutáveis, exceto remoção do fingerprint
  da origem na transição `active → merged`;
- `status`: controlado pela matriz;
- `version`: controlado por mutações aprovadas;
- `merged_into_cart_id`: somente definido em `active → merged`, nunca alterado depois;
- `expires_at`: imutável no contrato atual;
- `updated_at`: mantido pelo sistema.

## Mutabilidade dos itens e prevenção de phantom

Itens podem ser inseridos, atualizados ou removidos somente quando o parent está
`active`. `locked`, `converted`, `merged`, `expired` e `abandoned` são imutáveis.

Todas as funções de item bloqueiam primeiro `carts ... FOR UPDATE`, validam owner,
store, expiry e status, depois mutam o item e incrementam version na mesma transação.
A submissão também bloqueia primeiro a mesma linha do cart. Assim, mutation e
submission serializam pelo mesmo row lock.

Defesa estrutural adicional: trigger BEFORE INSERT/UPDATE/DELETE de `cart_items`
resolve o parent por `coalesce(new.cart_id,old.cart_id)`, adquire `FOR UPDATE` e exige
`active`. Em UPDATE de `cart_id`, bloqueia ambos os parents em ordem de UUID e rejeita
movimentação entre carts. Nas funções normais o lock já pertence à transação, então o
trigger apenas revalida sem inversão.

Como DML direto é revogado e até escrita privilegiada passa pelo parent lock/trigger,
não existe INSERT phantom depois que a submissão segura o cart. Não é necessário lock
de tabela.

## Guard do cart e versão

Um trigger de `carts` deve:

- rejeitar mudança de store/currency/created_at/expiry;
- aplicar exclusivamente a matriz de status;
- proteger owner/merge fields;
- exigir `new.version = old.version + 1` para transição de status/ownership;
- rejeitar redução ou salto de version;
- impedir qualquer saída de estado terminal.

Contrato de version:

- add: +1;
- set quantity: +1 somente quando a quantidade realmente muda;
- remove: +1 somente quando remove;
- merge: source +1 e target +1;
- prepare lock: +1;
- close/unlock: +1;
- submit/convert: +1.

Toda mutação de conteúdo ocorre dentro de função que atualiza a versão antes do
retorno. O trigger de item não tenta atualizar version sozinho, evitando recursão;
testes verificam atomicidade da função e rollbacks.

## Compatibilidade

`prepare_native_checkout` e `close_native_checkout` já são definer e continuam
funcionando após a revogação. Seus UPDATEs satisfazem a matriz e version +1. O merge
v2 preserva locks determinísticos, soma aditiva, idempotência e invalidação da guest
capability. Scripts/pgTAP continuam podendo montar fixtures pela role owner, mas devem
respeitar triggers ou usar setup em ordem válida; cleanup isolado já usa
`session_replication_role=replica` de forma local e restrita.

WooCommerce permanece runtime atual e não usa estas tabelas/funções. Nenhum código Woo,
feature flag ou checkout público muda.

## Defesa em profundidade escolhida

Opção D:

1. revogar DML direto;
2. endurecer/criar funções estreitas;
3. adicionar trigger de status/identidade/version;
4. adicionar trigger de item mutável com parent row lock;
5. trocar policies ALL por SELECT.

Somente revogar quebraria as funções invoker; somente funções deixaria bypass direto;
somente triggers manteria autoridade excessiva. A combinação elimina os três vetores.

## Testes futuros

Role tests para app e worker devem negar todo INSERT/UPDATE/DELETE direto nas duas
tabelas e permitir apenas EXECUTE explicitamente concedido. Browser/public/readonly
permanecem negados.

Matrizes independentes, mínimo 50 ciclos cada:

- add × lock;
- set quantity × lock;
- remove × lock;
- new variant insert × submission/cart lock;
- merge × lock;
- checkout close/unlock × item mutation;
- tentativa de mutação após converted;
- version contention.

Metas: phantom-after-lock, mutation-after-converted, lost increments, deadlocks,
timeouts e lost updates iguais a zero.

## Estratégia revisada

Usar opção 1: cart hardening no início da mesma migration 29, seguido da coluna/hash e
`submit_native_checkout`. As partes formam uma única fronteira de autoridade e devem
ser aplicadas/revertidas juntas. Separá-las deixaria um estado intermediário sem valor
operacional e adicionaria coordenação de deployment.

Delta revisado da futura migration 29:

1. funções v2 de create/add/set/remove/merge;
2. revogação dos overloads antigos e DML app/worker;
3. policies SELECT-only;
4. guard de status/identidade/version do cart;
5. guard de item mutável + parent lock;
6. `orders.submission_request_hash` e imutabilidade;
7. helper canônico `c3-request-v1`;
8. `submit_native_checkout`;
9. grants estreitos e comentários.

Migration 30: não necessária.

Fases: P0B design; A2 SQL candidato; B2 testes estáticos/security; C pre-apply com
rollback; D rebuild único autorizado; E1 cart runtime/concurrency; E2 submission
runtime/concurrency; F full P3-C.
