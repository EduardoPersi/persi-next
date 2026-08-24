# Validação de escala do catálogo — Fase E.3

## Resultado

## Fechamento E.4

A E.4 reproduziu os 100 como no-op em concorrência 1/2/4. O maior p95 foi 683 ms e o maior
produto individual ficou abaixo de um segundo. O p95 de 5.060 ms foi caracterizado como
outlier da passagem mista de criação na E.3, sem evidência de contenção sistemática ou
problema estrutural do PostgreSQL. O Performance Gate foi aprovado.

O Full Preflight Gate não foi aprovado: 197 preços com precisão superior a centavos, 29
repetições de GTIN e 14 conflitos de GTIN. Nenhum dos 2.980 restantes foi importado.

Gate B e Gate C aprovados, encerrando em exatamente 100 produtos e 100 default variants no
`persi-staging`. O WooCommerce foi usado somente para leitura. O catálogo completo não foi
importado.

## Gates

| Métrica | 50 | 100 |
| --- | ---: | ---: |
| Reconciliação | 50/50 | 100/100 |
| Diferenças críticas | 0 | 0 |
| Duplicações | 0 | 0 |
| Segunda passagem INSERT/UPDATE/DELETE | 0/0/0 | 0/0/0 |
| No-ops na segunda passagem | 1.019 | 2.037 |
| Relações de mídia | 115 | 244 |
| Assignments PIM | 32 | 70 |
| Banco | 14.601.363 B | 15.166.611 B |

## Decisões

- `primary_category_id` permanece NULL.
- Sale dates vêm exclusivamente dos campos GMT do Woo.
- A ausência de sale dates não bloqueia sale price.
- PIM e mídia usam sincronização diferencial autoritativa das relações.
- Definições globais compartilhadas não são apagadas ao remover uma relação.
- Estoque permanece snapshot e não cria reservation ou movement.

## Recomendação

Os dados e a idempotência permitem continuar tecnicamente, mas a importação dos 3.080
produtos não deve ser iniciada antes de revisão humana do p95 do Gate C, dos cinco valores
PIM ambíguos e das três opções locais unmapped. O limite efetivo do plano Supabase também
deve ser confirmado no painel/contrato antes de usar projeções como decisão operacional.
