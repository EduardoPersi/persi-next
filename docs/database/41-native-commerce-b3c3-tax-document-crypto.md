# B.3-C3-P3-C0-TAX — Durable tax document crypto

Data: 2026-09-04. Escopo: implementação e validação exclusivamente local/offline.

## Bloqueio resolvido e compatibilidade C2

P3-C encontrou ausência de uma transformação criptográfica server-only entre o documento fiscal temporário do envelope P3-A e o bundle durável de C2. A fundação agora existe em `lib/commerce/taxDocumentCrypto.ts`.

`orders.tax_id_ciphertext` é `text` sem limite declarado e armazena integralmente um envelope JSON opaco e versionado. `tax_id_type`, `tax_id_fingerprint` e `tax_id_masked` já possuem tipos e constraints compatíveis. Nenhuma migration ou alteração de schema foi necessária; o total permanece em 25 migrations locais.

## Documento canônico

O tipo é `cpf` ou `cnpj`, confirmado a partir do tamanho e do validator brasileiro existente. O valor canônico contém apenas 11 ou 14 dígitos. Pontuação e espaços aceitos no boundary não alteram identidade; letras, checksum inválido, comprimento incorreto e divergência tipo/valor falham com códigos seguros.

As máscaras são derivadas no servidor: CPF `***.***.***-XX` e CNPJ `**.***.***/****-XX`. Máscara recebida do cliente nunca é autoridade.

## Criptografia e envelope

- algoritmo: AES-256-GCM do `node:crypto`;
- chave: 32 bytes;
- IV: 12 bytes aleatórios novos por operação;
- authentication tag: 16 bytes;
- encoding binário: base64url;
- purpose: `persi.order.tax-document`, distinto de `persi.checkout.pii`;
- versão: `1`;
- formato estrito: `{"v":1,"kid":"...","iv":"...","tag":"...","ct":"..."}`.

O parser exige exatamente esses cinco campos, valida versão, key ID, base64url canônico e comprimentos de IV/tag. Campos ausentes, extras ou versões desconhecidas falham fechados.

O AAD canônico vincula purpose, versão, key ID, store ID, order ID e tipo fiscal. Portanto, o ciphertext de um pedido/store/tipo não autentica em outro contexto. Como o UUID do pedido pode ser gerado pela aplicação antes do INSERT, esse vínculo é compatível com a futura transação C3.

## Chaves e rotação

O provider fiscal usa namespace separado:

- `ORDER_TAX_DOCUMENT_KEY_ID`;
- `ORDER_TAX_DOCUMENT_ENCRYPTION_KEYS_JSON`;
- `ORDER_TAX_DOCUMENT_HMAC_KEY`.

As chaves permanecem server-only e fora do PostgreSQL, logs e Git. O envelope registra somente o key ID não secreto. Uma chave ativa nova passa a criptografar novos documentos, enquanto documentos antigos continuam autenticáveis se a chave histórica permanecer configurada. Key ID removido/desconhecido falha fechado.

## Fingerprint e privacidade

O fingerprint usa HMAC-SHA-256 com chave independente e purpose `persi.order.tax-document-fingerprint`. O material inclui store ID, tipo e dígitos canônicos. O escopo por store evita um identificador global correlacionável entre Persi, Loja do Gesseiro ou futuras lojas. O mesmo documento na mesma store gera o mesmo fingerprint; em stores diferentes, fingerprints diferentes.

O `c3-request-v1` não recebe CPF/CNPJ nem fingerprint fiscal adicional. O fingerprint PII já liga a identidade do checkout; duplicar o identificador fiscal no request hash não acrescentaria autoridade e ampliaria correlação.

## Transformação temporária para durável

`transformCheckoutPiiToDurableTaxDocument` autentica e decripta o envelope temporário P3-A, obtém o documento canônico e gera uma criptografia fiscal inteiramente nova. Não reutiliza ciphertext, IV, tag, purpose, AAD ou key namespace do checkout.

Repeated encryption do mesmo documento produz envelopes diferentes por causa do IV aleatório, mas preserva tipo, máscara e fingerprint dentro do mesmo escopo.

## Validação e tamper

`assertEncryptedTaxIdBundle` agora delega ao parser estrutural rigoroso; a antiga string arbitrária `cipher` não é mais aceita. Autenticidade completa é verificada apenas no decrypt autorizado.

Falham fechados: versão, key ID, IV, tag, ciphertext, order/store AAD, tipo, fingerprint e máscara adulterados. Os erros são códigos estáveis e não incluem documento ou material criptográfico.

## Persistência, projeção e logs

Uma fixture local criou store/cart/checkout/order/event sintéticos em uma transação, persistiu o bundle, comprovou ausência dos dígitos no row serializado, decriptou o valor correto e fez rollback integral. PostgreSQL não recebe chaves e não decripta dados.

`readNativeOrder` não seleciona `tax_id_ciphertext` ou `tax_id_fingerprint`. Somente tipo e máscara poderão ser expostos futuramente por uma projeção explicitamente controlada. O módulo não registra plaintext, ciphertext, IV, tag, fingerprint ou chaves.

## Evidências

- hashes P3-A/P3-B: correspondência exata;
- focused crypto/P3-A/C2: 23/23;
- regressão checkout/order/P3-A/P3-B/C1/C2: 62/62;
- persistência local: persistiu, plaintext ausente, decrypt aprovado, rollback aprovado;
- rebuild: 25 migrations, sem migration nova;
- pgTAP: 13 arquivos, 452 testes, todos aprovados;
- validações PIM/pricing/inventory: aprovadas; AI calls zero; overselling zero;
- typecheck: aprovado;
- build: aprovado após liberar a stack local já validada e executar com heap explícito; as indisponibilidades externas foram tratadas pelos fallbacks existentes;
- lint: zero erros e cinco warnings preexistentes fora do escopo;
- `git diff --check`: registrado no relatório final.

## Decisão e próximo gate

`NEW_SCHEMA_CHANGE_REQUIRED = NO`. O bloqueio fiscal de P3-C está resolvido em nível local. P3-C pode ser reiniciada somente mediante solicitação explícita e deve começar novamente pelos hashes, rebuild e pgTAP. Esta fase não reinicia P3-C, não implementa a transação C3 e não altera staging ou produção.
