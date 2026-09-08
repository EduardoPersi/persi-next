# B.3-C3-P3-B — Transaction integrity and store security hardening

Data da validação: 2026-09-04. Escopo: implementação e validação local, com auditoria read-only do staging. O runtime C3 permaneceu desabilitado.

## Contrato implementado

A migration `20260904050000_native_checkout_order_integrity_hardening.sql` sucede diretamente a P3-A. Ela reduz `stores` a leitura para `persi_app` e `persi_worker`, remove policies amplas e mantém apenas policies explícitas de `SELECT`. Roles de browser continuam sem acesso operacional.

`inventory_reservations.order_item_id` referencia `order_items(id)` com `ON DELETE RESTRICT`. Um índice único parcial impede que a mesma combinação de reserva e nível de estoque seja vinculada mais de uma vez. O vínculo é imutável depois de definido.

A função controlada `link_inventory_reservation_to_order_item` bloqueia as linhas relevantes e valida, na mesma transação:

- reserva ativa e ainda não expirada;
- existência do item de checkout que originou a reserva;
- mesma variante no nível de estoque, item de checkout e item de pedido;
- mesma quantidade na reserva, no checkout e no pedido;
- pedido originado da mesma sessão de checkout;
- repetição do mesmo vínculo como operação idempotente;
- rejeição de unlink ou relink para outro item.

Um trigger de tabela mantém as mesmas invariantes mesmo diante de atualização direta. A função controlada é concedida somente à role server `persi_app`.

## Evento inicial do pedido

Todo novo pedido deve encerrar a transação com exatamente um evento inicial canônico: `from_status IS NULL`, `to_status = 'pending'` e `source = 'system'`. A constraint trigger é deferred, permitindo criar o pedido e seu evento na mesma transação, mas impedindo commit ausente, incorreto ou duplicado. O histórico continua append-only.

A migration falha de forma fechada se detectar pedidos preexistentes sem esse contrato; não corrige histórico automaticamente.

## Request hash C3

O helper server-only `createNativeOrderRequestHash` usa SHA-256 e material determinístico versionado por `c3-request-v1`. O hash vincula store, checkout e cart com suas versões, assignment e price list, moeda, fingerprints de PII e destino, quote/key de frete, fingerprint/versão logística e itens canônicos. PII bruta e capability guest são explicitamente excluídas.

Erros do vínculo são convertidos por allowlist; mensagens ou detalhes não reconhecidos não atravessam a fronteira de observabilidade.

## Evidência local

- Docker Engine 29.7.2 / Docker Desktop 4.87.0.
- PostgreSQL local reconstruído do zero; 25 migrations aplicadas em ordem.
- pgTAP: 13 arquivos, 452 testes, todos aprovados.
- P3-B: grants/policies, vínculo válido e idempotente, relink/unlink, expiração, status, variante, quantidade, origem de checkout, evento inicial e rollbacks aprovados.
- Validação geral: PIM, SKU, GTIN, money, pricing, inventory, external mappings, Drizzle e `BIGINT → TypeScript bigint` aprovados.
- Inventory: 50 ciclos; 50 sucessos e 50 rejeições esperadas; burst 5/5; overselling zero.
- Concorrência PII: 20 ciclos/40 requests; 20 writes e 20 conflitos esperados; zero falhas.
- Cart: 20 ciclos/3 cenários; zero falhas.
- Checkout: 20 ciclos/220 execuções; zero falhas e overselling zero.
- Order: 20 ciclos/360 execuções; zero números ou pedidos duplicados, lost updates zero.
- Price authority: 20 ciclos/160 execuções; zero overlaps, versões duplicadas ou snapshots mistos.
- P3-B integrity: 20 ciclos; same-link seguro 20/20, conflito com vitória única 20/20 e evento inicial com vitória única 20/20; zero duplicatas, lost updates ou falhas.

## Staging e ordem futura de deploy

A auditoria read-only confirmou `persi-staging` (`vtrujmhhkmvjzfklzxip`), PostgreSQL 17.6, `transaction_read_only=on`, 23 migrations, uma store e um assignment, e zero orders, reservations, carts ou checkouts. P3-A e P3-B permanecem ausentes remotamente, como esperado. Escritas remotas nesta fase: zero.

Uma implantação futura exige nova autorização explícita, backup fresco, preflight read-only e confirmação de zero orders/reservations. A ordem é obrigatória:

1. `20260904010000_secure_checkout_pii_foundation.sql` — SHA-256 `a4ae5198f74af785154ba6275d3631be1950616c7a2a34425f168a240e8ab32d`;
2. `20260904050000_native_checkout_order_integrity_hardening.sql` — SHA-256 `12aabf11350cf0b3b58d886994b4daa127aac59e8f694fb42f5c41a3433d3459`.

Não reaplicar migration em estado de execução incerto. Reconectar primeiro em modo read-only e determinar o estado efetivo.

## Fora do escopo

Não houve deploy de P3-A/P3-B, ativação do runtime C3, inicialização comercial, processamento PIM, chamada a WooCommerce/Olist, alteração de preço/estoque, chamada a frete/pagamento, commit ou push. Produção permaneceu proibida e inalterada.
