# B.3-C3-P0 — Store price-list authority preflight

Data da auditoria: 2026-09-03. Esta fase foi somente de design e leitura. Nenhuma
migration, configuração comercial ou fixture foi criada.

## Estado observado

O schema possui `stores`, `price_lists`, `prices`, catálogo, carrinho e snapshots de
checkout, mas não possui uma relação autoritativa entre store e lista. `price_lists`
define `currency`, `channel`, `customer_segment`, `priority` e `status`. `prices` liga
uma variante a uma lista, usa valores `bigint`, status e períodos `[valid_from,
valid_to)`. O trigger `prices_prevent_overlap` serializa por variante/lista, rejeita
períodos ativos sobrepostos e exige que `prices.currency = price_lists.currency`.

Localmente há 22 migrations, zero stores/variantes/preços e uma lista vazia de seed,
`retail-brl`. No `persi-staging` (`vtrujmhhkmvjzfklzxip`, PostgreSQL 17.6), em uma
transação `READ ONLY`, foram encontrados:

- 22 migrations; zero stores, carts, checkouts e orders;
- uma lista `woo-brl`, BRL, channel `storefront`, ativa e priority zero;
- 3.080 variantes e 3.080 preços, todos pertencentes à lista e atualmente válidos;
- cobertura de 3.080/3.080 variantes, sem preços órfãos ou listas vazias;
- zero variantes sem preço, zero sobreposições dentro da lista e zero variantes com
  mais de uma lista atualmente utilizável;
- 186 preços com sale, todos atualmente vigentes; zero sales futuras ou expiradas.

Esse estado torna `woo-brl` uma candidata válida para o bootstrap futuro da Persi, mas
não lhe dá autoridade implicitamente. Código, nome, prioridade ou cardinalidade não
podem substituir configuração explícita.

## Resolução atual e lacunas

`prepare_native_checkout` recebe `p_price_list_id` do chamador. Ele valida somente que
a lista está ativa e na moeda do cart, e então junta cada item com um preço ativo e
vigente daquela lista. Não há seleção por `priority`, menor preço ou nome, nem fallback
Woo dentro da função. Entretanto, permitir que o chamador escolha o UUID constitui a
lacuna de autoridade: sem uma resolução server-side por store, um chamador privilegiado
pode escolher qualquer lista ativa compatível.

Fora do checkout, consultas PIM usam lateral `ORDER BY valid_from DESC LIMIT 1` sem
lista explícita. Isso é heurístico, mas pertence à visualização editorial PIM e não pode
ser reutilizado no checkout. O importador usa o código fixo `woo-brl`; isso identifica o
destino da sincronização, não a autoridade comercial da store.

O snapshot C1 guarda `price_id`, validade, valores, moeda e fingerprints. O `price_id`
permite descobrir a lista enquanto a linha existir, mas não prova que aquela lista era a
configuração autoritativa da store naquele instante. Faltam o ID e a versão imutáveis da
configuração e um snapshot explícito do `price_list_id`.

## Opções avaliadas

### A — `stores.default_price_list_id`

É simples e possui boa integridade referencial, mas representa somente uma lista atual.
Não modela contexto, moeda ou vigência, não preserva histórico de autoridade e força
alterações posteriores para wholesale, marketplace ou B2B. Não recomendada.

### B — `store_price_lists`

Uma tabela normalizada de atribuições permite integridade, multistore, moeda, contexto,
vigência, versão e auditoria sem duplicar catálogo. É a menor estrutura que satisfaz os
requisitos atuais e mantém extensões futuras possíveis. Recomendada.

### C — configuração comercial genérica/versionada

É flexível, mas introduz documento/configuração genérica, parsing e validação indireta
antes de existirem outros parâmetros comerciais. Complexidade prematura para C3.

### D — inferência por `price_lists.channel/customer_segment/priority`

Não é uma autoridade: múltiplas linhas podem empatar, prioridade muda sem snapshot de
configuração e a seleção ainda seria heurística. Rejeitada.

## Modelo recomendado

Criar em P1 uma tabela pequena `store_price_list_assignments`, com:

- `id uuid` como identidade imutável da configuração;
- `store_id uuid`, `price_list_id uuid` e `currency char(3)`;
- `context_code text`, inicialmente somente `storefront_retail`;
- `version bigint > 0`, monotônica dentro de store/moeda/contexto;
- `valid_from timestamptz` e `valid_to timestamptz null`, com período `[)`;
- `status record_status`, timestamps e referência de ator administrativa opcional.

Uma exclusion constraint deve impedir períodos ativos sobrepostos para a mesma
store/moeda/contexto. Uma unicidade em `(store_id, currency, context_code, version)`
impede reutilização de versão. A moeda da assignment deve coincidir com a lista e, para
o storefront atual, com `stores.default_currency`. Isso pode ser garantido por FKs
compostas após uniques auxiliares `(id,currency)` em stores/price_lists, evitando
validação apenas na aplicação.

`context_code` é deliberadamente explícito e pequeno. Novos contextos (wholesale,
marketplace, customer group ou região) exigirão configuração própria; não haverá
fallback para `storefront_retail`. Persi e Loja do Gesseiro compartilham produtos,
variantes e inventário quando apropriado, mas terão assignments e listas independentes.

Assignments devem ser administradas somente pelo servidor/admin. `anon` e
`authenticated` não recebem policy nem grant. `persi_app` precisa apenas de resolução
via função; `persi_worker` pode receber leitura operacional. Escrita deve ficar restrita
a uma função administrativa futura/role administrativa, nunca ao browser.

## Validade e falha fechada

A resolução exige exatamente uma assignment ativa e vigente, store ativa, lista ativa,
moedas iguais e exatamente um preço ativo/vigente por variante. Lista inativa, futura,
expirada ou ausente encerra a operação. Preço ausente ou ambíguo encerra toda a
transação. Não há fallback para outra lista, Woo, menor preço, última linha ou valor do
browser.

O schema atual já rejeita sobreposição ativa por variante/lista em insert/update. C3
deve ainda contar e validar o resultado set-based, pois corrupção histórica ou mudança
de status não pode produzir escolha arbitrária.

## Sale price determinístico

Para um instante transacional único `v_as_of`:

1. o preço-base é elegível quando ativo e `valid_from <= v_as_of < valid_to`, tratando
   `valid_to null` como aberto;
2. `unit_regular_amount_minor = list_amount_minor`;
3. sale é usada somente quando `sale_amount_minor` não é null,
   `sale_valid_from is null or <= v_as_of` e `sale_valid_to is null or > v_as_of`;
4. caso contrário, `unit_effective_amount_minor = list_amount_minor`.

Todos os cálculos permanecem em `bigint`; limites são inclusivos no início e exclusivos
no fim. Sale aberta em um ou ambos os lados é válida conforme essas regras.

## Snapshot mínimo do checkout

P1 deve acrescentar a `checkout_sessions`:

- `store_price_list_assignment_id uuid not null`;
- `store_price_list_assignment_version bigint not null`;
- `price_list_id uuid not null`.

O request/source fingerprint deve incluir esses três valores e `v_as_of`. O snapshot de
item continua guardando o `price_id`, período e valores; acrescentar `price_list_id` no
item é redundante se a sessão o guarda e todos os itens são obrigados a usar a mesma
lista. A função deve validar essa homogeneidade. O histórico passa a provar store,
contexto, lista, versão de configuração, instante e preços cobrados.

## Concorrência e performance

Checkout e alteração de autoridade devem serializar pelo mesmo store. A preparação
adquire lock compartilhado/compatível na store antes de resolver a assignment; o fluxo
administrativo de troca adquire lock exclusivo na mesma store. A assignment encontrada
é bloqueada durante a preparação e seu ID/versão é copiado ao snapshot. Assim, uma troca
conclui antes ou depois do checkout, nunca no meio dele. Um conflito de versão esperado
gera falha/retry integral; preços de versões diferentes jamais são misturados.

A resolução usa um único `v_as_of` e consultas set-based: carregar cart e itens, resolver
uma assignment e buscar todos os preços com join por `price_list_id` e variantes. A
contagem retornada deve ser igual à contagem de itens. Não há N+1. Os índices atuais de
`prices(price_list_id, product_variant_id, valid_from desc)` já atendem o lookup; P1 deve
adicionar índices/constraints de assignment para `(store_id,currency,context_code,
valid_from)` e versão.

## Contrato transacional futuro C3

1. iniciar transação e fixar `v_as_of`;
2. resolver e bloquear store ativa e moeda;
3. resolver exatamente uma assignment ativa/vigente para `storefront_retail`;
4. validar lista ativa e consistência de moeda; capturar ID/versão/lista;
5. bloquear e validar cart, proprietário, store, moeda e versão;
6. carregar todos os itens e preços autoritativos em consulta set-based;
7. exigir uma linha válida por item e calcular sale com `v_as_of`;
8. criar sessão e snapshots com configuração e fingerprints;
9. reservar inventário pelas primitivas existentes;
10. validar frete já cotado, totais e invariantes; marcar checkout ready;
11. commit.

Não há chamada externa nesse bloco. O cliente não envia `price_list_id`; no máximo envia
um contexto permitido, que o servidor valida ou fixa em `storefront_retail`.

Falhas internas propostas: `STORE_PRICE_CONFIG_MISSING`,
`STORE_PRICE_CONFIG_INACTIVE`, `STORE_PRICE_CONFIG_CHANGED`, `PRICE_LIST_INACTIVE`,
`PRICE_CURRENCY_MISMATCH`, `VARIANT_PRICE_MISSING`, `VARIANT_PRICE_AMBIGUOUS`,
`PRICE_EXPIRED` e `PRICE_CHANGED`. SQL e identificadores internos não devem ser expostos
ao cliente.

## Limites de ownership

Olist pode sincronizar catálogo, preço e inventário, mas não pode criar, ativar ou trocar
uma assignment store/lista. PIM não possui autoridade sobre preço comercial e permanece
independente. A sincronização de dados da lista e a configuração de autoridade são
operações separadas.

## Plano P1 e inicialização

P1 requer uma migration dedicada contendo a tabela/constraints/indexes, proteção de
imutabilidade/overlap, função server-only de resolução e as três colunas de snapshot em
`checkout_sessions`; Drizzle e testes locais devem acompanhar. Não é necessário alterar
`prices` nem colocar FK default em `stores`.

A migration cria apenas estrutura. Em etapa posterior e separadamente autorizada, um
bootstrap transacional criará a store Persi e atribuirá explicitamente a lista candidata
`woo-brl`. A Loja do Gesseiro terá bootstrap e lista próprios quando seus dados e regras
forem aprovados. Nenhuma store ou assignment real foi criada neste preflight.

Bloqueadores restantes para C3: implementar e validar P1 localmente; depois autorizar
deploy estrutural; por fim autorizar separadamente o bootstrap Persi/lista e validar a
configuração antes de qualquer runtime.
