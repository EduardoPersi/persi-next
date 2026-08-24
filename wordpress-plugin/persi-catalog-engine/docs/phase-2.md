# Fase 2 — Attribute Discovery Engine

## Objetivo e segurança

Esta fase descobre, normaliza, classifica e apresenta candidatos de atributos para revisão humana. Ela não cria taxonomias ou termos e não altera atributos de produtos. O módulo `attributes` só pode ser executado em Simulação (Dry Run), com bloqueio no navegador e no servidor.

Não são usados IA, embeddings ou serviços probabilísticos. O resultado é determinístico, auditável e identificado pelo ruleset `2.3.1`.

## Fluxo

1. A execução cria somente os `run_items` selecionados.
2. Variações são consolidadas no produto pai para evitar candidatos duplicados.
3. `ProductFamilyContext` identifica a família usando categoria e ancestrais antes do título.
4. Os extratores consultam dados estruturados do Olist, atributos Woo existentes, título e descrição.
5. `NormalizationService` preserva o valor original e produz valor normalizado, número e unidade.
6. O motor compara fontes, atributos e termos existentes e classifica conflitos.
7. Os candidatos são persistidos nas tabelas próprias e exibidos para revisão.

## Hierarquia das fontes

A apresentação segue esta prioridade: campo estruturado Olist; atributo estruturado WooCommerce; título com padrão contextual; descrição com estrutura `rótulo: valor`. Campos Olist reconhecidos por mapeamento humano são marcados como `MANUAL_MAPPING`. Nenhuma prioridade encobre divergências: valores normalizados diferentes para o mesmo conceito geram conflito.

## Conceitos e famílias

Conceitos iniciais: `cor`, `corrente_nominal`, `potencia`, `potencia_aparente`, `tensao`, `fase`, `bitola`, `medida_composta`, `secao_condutor`, `numero_polos`, `comprimento`, `diametro` e `rosca`.

Famílias iniciais: `electrical_breaker`, `electrical_wire_cable`, `electrical_switchgear`, `hydraulic_pipe`, `hydraulic_fitting`, `pump`, `shower`, `tool` e `generic`. A matriz conceito × família fica centralizada em `DiscoveryRules`.

## Normalização e contexto

- `16A` vira `16 A`.
- `2.5mm2` vira `2,5 mm²`; nunca vira bitola.
- `1/2CV` vira `0,5 CV`, preservando o original e a unidade comercial.
- `220V` vira `220 V`; `Bivolt` permanece `Bivolt`.
- Frações Unicode simples são reconhecidas.
- Medidas em milímetros só recebem conceito quando a família fornece contexto.
- `Disco 115mm` em ferramentas sugere diâmetro; `Tubo 50mm` em tubos sugere bitola.
- Uma medida genérica sem contexto recebe `ATTRIBUTE_UNSUPPORTED_CONTEXT`.

### Medidas comerciais compostas

Em conexões hidráulicas, o parser reconhece duas ou três medidas separadas por `x` ou `×`. A composição preserva ordem e repetição: `32x25mm` vira `32mmx25mm`, `32x3/4\"` vira `32mmx3/4\"` e `20x16x20mm` vira `20mmx16mmx20mm`. A composição completa é apresentada como um único candidato `medida_composta`; seus componentes permanecem na evidência estruturada, mas não são publicados novamente como candidatos de `bitola`.

O match registra seu intervalo em bytes com a política `COMPOSITE_CONSUMES_COMPONENTS`. Antes das regras de bitola simples, somente esses intervalos são mascarados no texto de análise. Assim, os componentes do composto não reaparecem, enquanto uma medida simples ou independente fora do intervalo continua sendo descoberta normalmente.

Quando apenas o último componente declara `mm`, a unidade é propagada aos anteriores. Em composições mistas como `32x3/4\"`, o componente numérico sem unidade é interpretado como milímetros e a fração com aspas permanece em polegadas. A evidência registra `COMPOSITE_UNIT_PROPAGATION` ou `COMPOSITE_CONTEXT_INFERENCE`. Variações de espaçamento, aspas e repetição da unidade ficam em aliases de busca; não se tornam termos adicionais.

Esse reconhecimento só é habilitado para a família `hydraulic_fitting`. Chapas, caixas, parafusos, fitas e outros contextos genéricos não geram `medida_composta`.

## Mapeamento e termos existentes

O mapeamento aceita alias de origem, conceito, família opcional, categoria opcional e taxonomia Woo existente. `auto_write` permanece sempre desativado. O motor procura equivalência normalizada com valores e termos existentes para evitar falsos conflitos.

Bitolas em polegadas são direcionadas para `pa_bitola` e bitolas métricas para `pa_bitola-em-milimetros`. A composição completa tem como destino planejado `pa_medida`. Se essa taxonomia não existir, o candidato recebe `ATTRIBUTE_DESTINATION_MISSING`; o plugin nunca cria uma `pa_*`.

## Banco e idempotência

A versão de banco 10 mantém a migração aditiva e acrescenta aos candidatos o valor de exibição, a origem da unidade, os componentes ordenados e os aliases de busca. Dados existentes são preservados por `dbDelta`.

Cada execução mantém seu conjunto independente de candidatos. A deduplicação em memória usa conceito, valor normalizado e fonte; produto pai evita repetição por variação.

## Performance e limite

O discovery roda somente em execução explícita e assíncrona. Não é ligado a navegação, carrinho, checkout ou REST normal. A fila usa `LIMIT`, workers pequenos, cache de mappings no worker e cache de termos por taxonomia. O snapshot Olist existente é reaproveitado pelo fluxo de consulta sempre que disponível.

“Máximo de itens” significa “até este total”. Se forem solicitados 100 e o critério encontrar 24 elegíveis, a fila terá 24 e a interface mostrará `24 disponíveis (100 solicitados)`.

## Estados de revisão

- Novo candidato (`ATTRIBUTE_CANDIDATE`)
- Já preenchido (`ATTRIBUTE_ALREADY_SYNCED`)
- Conflito (`ATTRIBUTE_CONFLICT`)
- Mapeamento necessário (`ATTRIBUTE_MAPPING_REQUIRED`)
- Revisão necessária (`ATTRIBUTE_REVIEW_REQUIRED`)
- Contexto não suportado (`ATTRIBUTE_UNSUPPORTED_CONTEXT`)
- Destino de atributo ausente (`ATTRIBUTE_DESTINATION_MISSING`)
- Sem valor encontrado (`ATTRIBUTE_NO_VALUE`)

## Validação operacional recomendada

Executar primeiro uma Simulação manual com dez itens representativos. Conferir evidência, família, conceito, normalização, destino e confiança. Depois, repetir com cinquenta itens. Não executar sincronização real de atributos: esta versão termina em candidato e revisão.
