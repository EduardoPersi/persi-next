# B.3-A — stores e customer foundation

## Escopo

Implementação local das tabelas `stores`, `customers`, `customer_identities` e
`customer_addresses`. Não inclui seed, repositories, APIs, Supabase Auth,
importação WordPress, checkout, pedidos ou qualquer write remoto.

## Decisões concretas

- Customer é global entre stores. A participação em uma loja será expressa por
  carts/orders futuros; isso evita duplicar PII.
- `stores.code` é a chave humana estável; domínio/slug não é identidade.
- Email é nullable, normalizado pelo banco para lookup e não é UNIQUE. Uma
  identidade só é estabelecida por `(issuer, subject)`.
- Telefone preserva display em `phone`; `phone_normalized`, quando presente,
  exige E.164 e é preenchido pela aplicação server-side.
- CPF/CNPJ somente pode ser persistido como bundle completo: type, ciphertext e
  HMAC SHA-256 hexadecimal. Não existe coluna plaintext. A chave de cifra/HMAC
  será server-only; B.3-A não cria utilitário ou variável porque não há write
  path autorizado.
- Endereço brasileiro exige country `BR`, UF uppercase e CEP com oito dígitos.
  Para outros países, conteúdo é preservado conservadoramente sem inferência.
- Endereço reutilizável é soft-archived. Customer com identidade/endereço usa FK
  `RESTRICT`; futuros order snapshots nunca dependerão do endereço mutável.

## Acesso e LGPD

| Campo | Classe |
| --- | --- |
| store code/name/status/currency/timezone | NON_SENSITIVE |
| email, phone e valores normalizados | PERSONAL |
| tax ID ciphertext/fingerprint/type | SENSITIVE_OPERATIONAL |
| recipient e endereço completo | PERSONAL / SENSITIVE_OPERATIONAL |
| issuer/subject de autenticação | SENSITIVE_OPERATIONAL |
| senha, OAuth secrets, tokens e chaves | SECRET — proibidos nestas tabelas |

Todas as tabelas têm RLS. `anon` e `authenticated` não recebem grants nem
policies. `persi_app` e `persi_worker` recebem somente SELECT/INSERT/UPDATE;
`persi_readonly` enxerga apenas stores. A UI não é fronteira de autorização.

## Normalização

- store code e auth issuer: formato lowercase estável por CHECK;
- email: `lower(btrim(email))` generated column;
- phone: E.164 na coluna de lookup, sem inferência no banco;
- country/state: uppercase exigido; CEP BR: oito dígitos;
- campos opcionais vazios devem virar NULL no futuro write path;
- conteúdo significativo de endereço nunca é reescrito silenciosamente.

## Retenção

Customers são anonimizados por transição consistente: PII/document bundle nulos,
`status=anonymized` e `anonymized_at`. Endereços usam `status=archived` e
`archived_at`. Exclusão física não é API operacional e relações usam RESTRICT.
Prazos definitivos dependem de política jurídica/contábil antes da produção.
