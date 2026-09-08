# Native commerce B.3-C2 — fundação de pedidos

Status: implementação e validação exclusivamente local. O runtime nativo continua desabilitado.

## Identidade, numeração e estado

`orders.id` é UUID canônico. Cada store mantém `next_order_sequence bigint`; a função
atômica `allocate_native_order_number` incrementa a linha da store e retorna o número
anterior, sem `MAX()+1`. O display estável segue `STORE-YYYY-NNNNNN`, mas decisões não
dependem de interpretar esse texto. Sequência e display são únicos dentro da store.

O requisito B.2 prevalece sobre a lista preliminar C0: `order_status` contém somente
`pending`, `confirmed`, `cancelled` e `completed`. Pagamento, reserva e shipment possuem
máquinas independentes. Transições usam estado+versão esperados e geram evento no mesmo
procedimento controlado.

## Snapshots e dinheiro

`order_items`, `order_addresses` e `order_adjustments` são históricos imutáveis e
append-oriented. Referências nullable ao catálogo usam `ON DELETE RESTRICT`, coerente com o
soft-delete/status atual e sem conflito com os triggers de imutabilidade; SKU, GTIN, nome,
variante e valores preservam a compreensão do pedido. Dinheiro autoritativo usa
`bigint` em minor units. Constraints protegem aritmética de linha e do agregado; a função
`validate_native_order_totals` reconcilia itens e ajustes antes da futura finalização C3.

Ajustes armazenam magnitude positiva e direção explícita `discount` ou `charge`.
Correções são novas linhas ligadas por `reverses_adjustment_id`; registros anteriores nunca
são reescritos. Cupom é apenas snapshot de código/descrição/valor, sem motor de cálculo.

## Contato, endereço e LGPD

Guest order mantém `customer_id` nulo e snapshot mínimo de nome, email e telefone. Endereço
usa recipient, street, number, complement, neighborhood, city, UF, CEP e país normalizados.
`customer_addresses` é somente proveniência; mudanças no perfil não alteram o pedido.
CPF/CNPJ plaintext é proibido. O bundle opcional exige tipo, ciphertext produzido no
servidor e fingerprint HMAC; a chave permanece fora do banco. Retenção/anonymization será
um workflow legal explícito futuro, nunca DELETE ordinário.

## Segurança e leitura

As cinco tabelas têm RLS. Somente `persi_app` e `persi_worker` recebem SELECT técnico;
browser, `public` e `persi_readonly` não recebem acesso. DELETE não é concedido. Funções
`SECURITY DEFINER` usam `search_path` vazio e execução pública revogada. O repositório
`lib/db/nativeOrder.ts` é server-only e monta o agregado com subconsultas set-based, sem N+1.

## Fronteiras futuras

- C3 criará pedido, itens, endereços e evento inicial atomicamente a partir do checkout;
  `UNIQUE(checkout_session_id)` já impede duplicação.
- B3-D adicionará tentativas/eventos de pagamento e confirmará reservas após pagamento.
- B3-F ligará shipments ao pedido nativo.
- `external_mappings` fará identidade Woo/Olist futura; IDs externos não entram na PK.
- `STORE_PRICE_LIST_MAPPING_STATUS = REQUIRED_BEFORE_C3`; não existe seleção heurística.

Esta fase não criou payment tables, refunds, outbox, mappings, pedidos reais, rotas ou
integrações. Woo cart/checkout/order permanecem ativos e inalterados.
