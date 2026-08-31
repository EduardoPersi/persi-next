# PIM P.3 — arquitetura de enriquecimento

## Pipeline e limites

`SOURCE DATA → extração determinística → normalização → evidências/conflitos → provider abstrato → output Zod → suggestion → revisão humana → draft`.

Após o output Zod, uma reconciliação determinística compara novamente os candidatos de origem com os atributos sugeridos. Conflitos de fonte sempre prevalecem sobre a escolha do modelo, preservam todos os candidatos/evidências e bloqueiam campos editoriais que consolidem um valor conflitante. Não existe majority voting nem precedência silenciosa.

Quando o modelo omite apenas a unidade de um valor atômico, o pós-validador pode restaurar o valor canônico da fonte somente se o atributo e a magnitude coincidirem, houver exatamente um candidato fonte evidenciado, o modelo não trouxer unidade explícita e não existir conflito. A decisão `MODEL_RETURNED_INCOMPLETE_VALUE_RECONCILED_FROM_SOURCE` preserva separadamente o valor bruto e o valor canônico. Não existe inferência genérica de unidade nem conversão matemática.

A IA é assistente e nunca fonte de verdade. SKU, GTIN operacional, preço, estoque, movimentos e mappings não possuem caminhos de escrita no motor. Aceitar uma sugestão editorial cria ou altera somente o draft; não altera `approved_content` e não publica. `MAX_AI_PRODUCTS_PER_RUN` inicia em 1. Não existe loop sobre o catálogo nem chamada externa nesta fase.

## Componentes

- `PimAttributeExtractor`: candidatos em título, descrição, marca e atributos estruturados;
- normalization: medidas/unidades sem inferir unidade de número isolado;
- `PimEnrichmentProvider`: interface desacoplada; somente mock disponível;
- structured output: contrato Zod estrito, com evidência obrigatória por fato técnico;
- source fingerprint: SHA-256 do contexto canônico;
- `pim_suggestions`: payload validado, provenance, provider/model/prompt, usage futuro e retenção superseded.

## Segurança

Conteúdo de origem é tratado exclusivamente como dado. Prompt injection não pode acionar workflow. O provider deve retornar `null`/`needsEvidence` quando faltar evidência e nunca inventar SKU, GTIN, marca, modelo, medidas, elétrica, certificação, pressão, material, compatibilidade, garantia ou norma. Ações administrativas derivam actor da sessão server-side; PostgreSQL continua sob RLS sem policy pública.

## Fontes futuras

`PimEvidenceProvider` poderá consultar fabricante oficial, manual, datasheet ou referência confiável em fase própria. Fabricante oficial terá precedência; marketplaces não serão copiados e crawling amplo permanece proibido.
