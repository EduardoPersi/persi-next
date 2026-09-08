# B.3-C3-P3-C — final integrated validation

Data: 2026-09-05. Escopo: exclusivamente local, com
`PERSI_OFFLINE_VALIDATION=1`. Resultado: **hard stop no gate de composição**, antes
da criação do harness integrado.

## Baseline confirmado

- Docker Engine: `29.7.2`;
- PostgreSQL: `17.6`, endpoint local `127.0.0.1:15422`;
- migrations: 28 arquivos e 28 registros, última `20260905130000`;
- pgTAP inicial: 16 arquivos, 508/508, PASS;
- P3-A: `a4ae5198f74af785154ba6275d3631be1950616c7a2a34425f168a240e8ab32d`;
- P3-B: `12aabf11350cf0b3b58d886994b4daa127aac59e8f694fb42f5c41a3433d3459`;
- migration 26: `8027bdad8973bcb3af92ac956f59dd0f81cae236a21fbe655282adea73c449df`;
- migration 27: `57eae6e2cead7a3e272c6fb69abddc9d0c58118ef8ad8ef287942d25a9a2cad0`;
- migration 28: `7d938dc2578aef9fac8c82058ea2a3dd7280546a9de0e9e52f6cd9cd3a39d45c`.

O snapshot persistente anterior e posterior ao preflight foi o mesmo: somente
`inventory_locations=1` e `price_lists=2`; as outras 26 tabelas monitoradas
estavam com zero linhas. Nenhuma fixture foi criada.

## Mapa de composição encontrado

| Etapa | Primitiva/contrato existente | Situação |
|---|---|---|
| checkout e cart | locks de linha em `mark_native_checkout_ready` e `prepare_native_checkout` | disponível |
| autoridade de preço | `resolve_store_price_authority`, advisory transaction lock | disponível |
| preço atual | `resolve_checkout_authoritative_price`, `FOR KEY SHARE` | disponível |
| frete | evidência imutável, quote imutável em `ready`, fingerprint canônico | disponível |
| reserva | `inventory_reservations` e `link_inventory_reservation_to_order_item` com lock | disponível |
| número | `allocate_native_order_number`, atualização transacional da store | disponível |
| PII temporária | `read_checkout_pii_envelope` + AES-256-GCM server-only | disponível |
| documento fiscal durável | `transformCheckoutPiiToDurableTaxDocument` com IV e AAD novos | disponível |
| criação do agregado | INSERT em order/items/addresses/adjustments/event | **sem primitiva runtime** |
| transições finais | UPDATE de checkout e cart | **sem primitiva runtime integrada** |

## Blocker estrutural

O catálogo local confirmou:

- `persi_app` não possui `INSERT` ou `UPDATE` em `orders`, `order_items`,
  `order_addresses`, `order_adjustments` ou `order_status_events`;
- `persi_app` não possui `UPDATE` em `checkout_sessions`;
- as únicas funções relacionadas disponíveis são
  `allocate_native_order_number` e `link_inventory_reservation_to_order_item`;
- não existe função `submit_native_checkout`, `create_native_order` ou equivalente
  que componha revalidação, criação do agregado e transições finais em uma única
  transação com autoridade controlada.

Executar INSERTs como owner no harness provaria apenas que o owner consegue ignorar a
fronteira runtime; não provaria o contrato solicitado. Compor wrappers atuais também
não é suficiente: eles obtêm conexões por operação e não fornecem a operação única e
atômica exigida.

Classificação: `P3C_SUBMISSION_TOCTOU_GUARD_MISSING`.

Respostas do gate:

- `CAN_ALL_REQUIRED_STEPS_RUN_IN_ONE_POSTGRES_TRANSACTION = NO` para a autoridade
  runtime disponível;
- `CAN_PRICE_BE_REVALIDATED_INSIDE_SUBMISSION_TX = NO`, pois não há submission tx;
- `CAN_SHIPPING_BE_REVALIDATED_INSIDE_SUBMISSION_TX = NO`, pela mesma razão;
- `CAN_RESERVATIONS_BE_REVALIDATED_INSIDE_SUBMISSION_TX = NO`, pela mesma razão;
- `CAN_ORDER_NUMBER_AND_ORDER_BE_CREATED_IN_SAME_TX = NO` sob `persi_app`;
- `CAN_RESERVATION_LINK_AND_INITIAL_EVENT_BE_ATOMIC_WITH_ORDER = NO` sob `persi_app`;
- `CAN_CHECKOUT_ORDER_CREATED_AND_CART_CONVERTED_BE_ATOMIC = NO` sob `persi_app`.

## Consequências do hard stop

Conforme o protocolo, não foram criados nem executados: harness final, happy paths,
cenários TOCTOU, idempotência de submissão, rollbacks integrados, matrizes concorrentes
de submissão e regressão pós-harness. Nenhum desses gates foi herdado das fases
anteriores.

É necessária uma mudança versionada separada que forneça uma primitiva server-only de
submissão com lock order determinístico, revalidações internas e criação/transições
atômicas. Este diagnóstico não autoriza o desenho nem a criação dessa migration.

- `NEW_SCHEMA_CHANGE_REQUIRED = YES`;
- `MIGRATION29_CREATED = NO`;
- staging e produção não foram acessados;
- requests externos reais: zero;
- runtime nativo permaneceu desativado;
- commit/push não executados.

## M29-P0 design

O design read-only da fronteira transacional foi concluído em 2026-09-05. A solução
proposta preserva DML direto revogado e usa uma função estreita `SECURITY DEFINER`,
helper canônico de hash e persistência imutável de `c3-request-v1` no pedido. Nenhuma
migration foi criada. Detalhes em
`docs/database/48-native-commerce-b3c3-m29-atomic-submission-design.md`.
