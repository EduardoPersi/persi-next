# B.3-C3-P3-A — Secure checkout PII foundation

Data da validação: 2026-09-03. Escopo: implementação e validação local; runtime nativo permaneceu desabilitado.

## Contrato implementado

`checkout_sessions` recebeu um envelope temporário completo ou totalmente nulo: ciphertext, IV, authentication tag, versão, key ID não secreto, fingerprints separados de PII e destino, expiração e data de atualização. Não há colunas plaintext para contato, endereço, CPF ou CNPJ. O índice parcial `checkout_sessions_pii_expiry_idx` suporta limpeza apenas das linhas que contêm PII.

O modelo canônico preserva separadamente rua, número, complemento e bairro, além de contato, cobrança e entrega. A normalização mantém acentos e caracteres significativos. O envelope não contém cartão, capability de convidado ou token.

## Criptografia e chaves

- AES-256-GCM via `node:crypto`, chave de 32 bytes, IV aleatório de 12 bytes e tag de 16 bytes.
- Armazenamento base64url; AAD liga purpose, checkout, store, versão e key ID.
- Provider server-only resolve chaves por key ID e permite rotação; segredo de criptografia e chave HMAC nunca são persistidos no PostgreSQL.
- HMAC-SHA-256 usa chave separada e purposes distintos para o conteúdo PII e para o destino de entrega.
- Ciphertext, IV, tag, fingerprints, AAD incorreto, expiração e key ID desconhecido falham de forma fechada.

Variáveis server-only documentadas em `.env.example`: `CHECKOUT_PII_KEY_ID`, `CHECKOUT_PII_ENCRYPTION_KEYS_JSON` e `CHECKOUT_PII_HMAC_KEY`. Nenhum valor real foi criado, lido ou registrado nesta fase.

## Persistência e ciclo de vida

As operações server-only `persist_checkout_pii`, `read_checkout_pii_envelope` e `clear_checkout_pii` validam owner customer ou capability guest convertida em fingerprint. UUID isolado não autoriza acesso. Persistência exige versão otimista e estados `open`/`validating`; `ready` e estados posteriores são imutáveis. Limpeza total e minimizada só é permitida em `submitting`, `order_created`, `expired` ou `cancelled`.

Mudança do fingerprint canônico de destino remove transacionalmente as cotações ligadas ao checkout. O read model público não projeta material criptográfico. O futuro request hash C3 deverá incorporar `pii_fingerprint` e `pii_destination_fingerprint` junto aos inputs autoritativos já existentes, sem incluir capability; o hash atual não foi alterado em P3-A.

Os grants de tabela foram reduzidos para SELECT explícito de colunas não PII. Roles browser não têm table access, policies públicas ou execução das funções. O acesso ao envelope ocorre apenas pela função owner-checked concedida à role server `persi_app`.

## Logs externos

Woo REST, PagBank e Mercado Pago agora passam erros por um sanitizador fail-closed que registra somente provider, operação sanitizada, status e code allowlisted. Respostas brutas, mensagens, `cause`, endereço, documento e email não são serializados.

## Evidência local

- Docker Engine 29.7.2 / Docker Desktop 4.87.0; PostgreSQL local reconstruído do zero.
- 24 migrations locais aplicadas, incluindo `20260904010000_secure_checkout_pii_foundation.sql`.
- SHA-256 da migration: `a4ae5198f74af785154ba6275d3631be1950616c7a2a34425f168a240e8ab32d`.
- pgTAP: 12 arquivos, 413 testes, todos aprovados; teste P3-A focado: 22/22.
- Testes runtime PII: 5/5; canonicalização, round trip, AAD, tamper, expiração, fingerprints e logs.
- `npm run db:test`: aprovado; PIM editorial e AI offline aprovados, chamadas AI zero; pricing single-writer aprovado; inventory 50 ciclos, overselling zero.
- Concorrência PII: 20 ciclos / 40 requests; 20 writes, 20 version conflicts, zero stale quote, zero falhas.
- Regressões concorrentes: cart 20 ciclos, checkout 20 ciclos/220 execuções, order 20 ciclos/360 execuções e price authority 20 ciclos/160 execuções; zero falhas e zero overselling.
- Typecheck e build: aprovados. Lint: zero erros e cinco warnings preexistentes/fora do escopo. `git diff --check`: aprovado.
- `npm test`: 654/655 aprovados; uma falha preexistente fora do escopo em `tests/instagramFeed.test.mjs`, que ainda espera `InstagramCarousel` enquanto o componente atual usa `InstagramCarouselLazy`.

## Staging read-only

Alvo confirmado `persi-staging` (`vtrujmhhkmvjzfklzxip`), PostgreSQL 17.6. A transação reportou `transaction_read_only=on`. O remoto permanece com 23 migrations; o local tem 24. As nove colunas PII e a migration P3-A estão ausentes remotamente, conforme esperado. Escritas remotas nesta fase: zero.

## Trabalho ainda fora do escopo

P3-B continua responsável pelo desenho/validação restante de grants operacionais, vínculo definitivo reservation/order e enforcement do primeiro evento de pedido. C3 continua responsável por orquestração e integração do request hash; nenhuma dessas fases foi iniciada.

Produção, WooCommerce, Olist, provedores de pagamento e frete não foram chamados ou alterados. Não houve commit nem push.
