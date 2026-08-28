# F.4.2B — Price history single-writer

## Causa raiz

Uma alteração real de preço (`7100 → 8835`) gerou duas linhas equivalentes porque havia dois writers automáticos: o trigger PostgreSQL `capture_price_history` e um insert explícito no importador. O problema era de responsabilidade duplicada, não de concorrência do banco.

## Correção

O importador deixou de inserir diretamente em `price_history`. O trigger PostgreSQL é agora a única autoridade automática de histórico. A migration `20260827133500_price_history_single_writer_cleanup.sql` remove somente pares comprovadamente redundantes: exatamente uma linha do trigger, sem `source_event_id`, e uma linha do importador com evento `product:%`, com transição, moeda e timestamp idênticos. Grupos ambíguos ou repetidos são preservados.

## Validação local

- PostgreSQL 17.6.
- 14/14 migrations aplicadas após reconstrução do banco, incluindo a fundação PIM V1 já presente no GitHub.
- pgTAP: 51/51 (14 testes específicos de price history).
- Alteração real: exatamente uma linha.
- No-op e atualização técnica: zero linhas.
- Inclusão, mudança e remoção de promoção: uma linha por transição.
- Tentativas concorrentes sobre o mesmo preço: um update efetivo e uma linha.
- Segunda passagem: zero linhas.
- Cleanup versionado: par exato removido; grupo ambíguo preservado.
- Concorrência de estoque: 50 ciclos e burst 10/5, zero overselling.

## Aplicação e auditoria em staging

Antes da migration havia 2 linhas de histórico, formando um grupo duplicado confirmado e nenhum caso ambíguo. A migration removeu uma linha redundante e preservou a linha canônica. Depois da aplicação:

- migrations: 13;
- `price_history`: 1 linha canônica;
- grupos duplicados: 0;
- casos ambíguos: 0;
- trigger/função: 1/1;
- produtos, variantes, preços e estoque: 3.080 cada;
- external mappings: 12.898;
- inventory movements: 0;
- RLS: 27/27; policies públicas: 0;
- schema drift: não detectado.

As reconvergências posteriores não criaram novas duplicatas. Nenhuma migration já reconhecida foi reaplicada, nenhum reset remoto foi feito e nenhuma fixture material permaneceu no staging.

## Limites operacionais

Não foram alterados WooCommerce, checkout, pedidos, pagamentos, Olist, Hostinger, Cloudflare, DNS ou produção. Gate B, Stage 0, canário e deploy permanecem fora do escopo executado.
