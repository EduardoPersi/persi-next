# PIM P.3 — evidência, confiança e conflitos

Cada evidência registra `sourceType`, referência, valor bruto, valor normalizado, confidence e método. Autoridade inicial: fabricante oficial > fonte estruturada > PIM aprovado > título > descrição > referência confiável > inferência de IA.

Confidence é de 0 a 1: HIGH ≥ 0,85; MEDIUM ≥ 0,60; LOW abaixo de 0,60. Nenhuma faixa autoriza aprovação automática.

Valores divergentes para o mesmo atributo geram `CONFLICT`, preservam todas as evidências e seguem para revisão. Exemplo: título `220V` e descrição `127V` não produzem vencedor. Medidas compostas como `25mm x 1/2"` permanecem um único valor canônico; componentes futuros podem existir apenas para busca/comparação.

A validação semântica cruza tipo, valor e unidade antes de aceitar o contrato estruturado: tensão usa `V`, corrente usa `A`, potência usa `W`, `kW`, `HP` ou `CV`, e temperatura de cor usa `K`. Unidade incompatível gera `SEMANTIC_UNIT_MISMATCH`, sem conversão automática. Declarações negativas ou de ausência, como “material não informado”, não constituem fatos positivos.

Validade estrutural da evidência não implica consistência. Se fontes normalizadas divergem, o pós-validador produz `CONFLICT`, mantém cada valor com suas evidências e define `editorialBlockedByConflict`, `humanReviewRequired` e `acceptableForDraft=false`. A IA não pode ocultar o conflito escolhendo ou omitindo um candidato.

Restauração canônica não cria evidência: `20` pode terminar como `20mm` apenas quando o mesmo atributo possui um único candidato fonte `20mm`, com a mesma magnitude e evidência preservada. `20cm`, `25`, candidatos ambíguos e medidas compostas não são convertidos ou corrigidos silenciosamente. Sem unidade na fonte, nenhuma unidade é inventada.

Status persistido reutiliza o modelo existente: pending = `needs_review`, accepted = `approved`, rejected = `rejected`; `superseded_at` retém sugestões substituídas. Aceitar conteúdo editorial move o valor para draft. Rejeitar mantém suggestion e auditoria.
