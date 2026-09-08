# M31 — checkout submission authority null-safe

Data da validação: 2026-09-07.

## Escopo

A migration `20260907180000_native_checkout_submission_authority_null_safe.sql` corrige exclusivamente o predicado de autorização de `submit_native_checkout` para que combinações com `NULL` falhem de forma fechada. M29 e M30 permanecem imutáveis. Nenhuma alteração foi aplicada ao Supabase local canônico, staging ou produção.

## Evidências descartáveis

- PostgreSQL 17.6, imagem local já disponível `public.ecr.aws/supabase/postgres:17.6.1.155`, armazenamento `tmpfs` e zero chamadas externas.
- Baseline 1–30: o exploit exato foi reproduzido; customer incorreto com guest fingerprint `NULL` recuperou indevidamente o pedido.
- Pós-M31 1–31: exploit bloqueado com SQLSTATE `42501` e `CHECKOUT_OWNERSHIP_INVALID`.
- Matriz guest/customer/recovery: 14 sucessos autorizados, 20 rejeições esperadas, zero recuperações não autorizadas, duplicatas, pedidos parciais, deadlocks, timeouts ou vazamento de role.
- Smoke concorrente M31: 10 ciclos, zero sucesso ou recuperação não autorizada.
- Funcional: 65/65 cenários; double-submit 20/20; divergent hash 20/20; zero erros sem classificação.
- Carrinho: 20 ciclos × 3 cenários, zero falhas.
- Checkout: 20 ciclos × 6 cenários, 220 execuções, zero falhas e zero overselling.
- E1 self-test limpo: 16 ciclos, 78 operações, zero sucesso não autorizado e exatamente 2 pedidos sintéticos esperados.
- pgTAP: 17 arquivos, 534 assertions, todas aprovadas (8 assertions novas).
- `npm test`: 707/708; única falha é o baseline não relacionado do Instagram carousel.
- Typecheck e lint aprovados. O build offline chegou ao bloqueio conhecido das fontes Google/Inter; nenhuma requisição externa foi realizada.

## Segurança e invariantes

O contrato da função permanece com uma única assinatura, owner `postgres`, `SECURITY DEFINER`, `search_path` vazio e execução concedida apenas a `persi_app`. `persi_worker`, `PUBLIC`, `anon` e `authenticated` não possuem execução. A submissão não cria movimento de reserva ou venda e não altera `on_hand` ou `reserved`.

## Estado canônico

A auditoria S0/S1 foi feita dentro de transação read-only: PostgreSQL 17.6, histórico 30/30, última migration `20260907120000`, zero carts/checkouts/orders/cart_items e M31 ausente. Portanto, a M31 está liberada apenas para uma futura aplicação canônica explicitamente autorizada.

## Hashes congelados

- M29: `09878bc2926f3683d993e2532649b92d6fc9a56e939103ea98e07347bf8b347a`
- M30: `db393c838157b3581eb269042835ace265b97be86f34f840f69ecf9436d1ed6c`
- M31: `f09bb724a0afd729771945b0ca264678629d1edf801d1bfb792ed416068e21f2`
- E1: `51c0e64bb4f7d0ebf56cf36e38609330d253518fc7e223674e8c7bf9b8f77183`
- E2: `9989144a2cbfecdc5ae432c1f4e1df605a3113a45d59e9b4b1f8a9dd1d465a39`

## Gate

`M31_R1_PASS=YES` e `SAFE_TO_APPLY_M31_CANONICAL=YES`. A execução para aqui: M31 não foi aplicada ao canônico, M32 não foi criada e E2/P3-C não foram retomadas.
