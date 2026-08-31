# PIM P.3 — estratégia de testes

O golden dataset contém 10 produtos representativos de hidráulica, elétrica, ferramentas, impermeabilização e iluminação. Cobre medidas compostas, polegada, 127V, 220V, 20A, 500W, ausência de atributo, conflito e descrição pobre/adversarial.

Os testes puros validam extração, normalização, unidades, conflitos, evidence, confidence, output inválido, fingerprint, provider mock e prompt injection. pgTAP valida migration, JSONB, constraints, índices, RLS e ausência de policies. O teste PostgreSQL real valida idempotência, superseded, aceitar/rejeitar, suggestion → draft, draft ≠ approved, zero publicação e zero alteração operacional.

O dataset P.3D-FIX acrescenta temperatura de cor em Kelvin, matriz semântica de unidades, classificações inválidas, polaridade de ausência, aplicação evidenciada, medidas compostas, conflito, título limitado às fontes e construção anti-injection. O prompt `pim-enrichment-v2` exige compatibilidade entre tipo de atributo e unidade.

Chamadas externas, custo e produtos processados por IA permanecem zero. Um primeiro teste real exigirá provider e credencial explicitamente aprovados, escopo de um produto, estimativa de custo e nova autorização. Processar 3.080 produtos e publicar conteúdo continuam proibidos.
