# Segurança e acesso — Persi Database V1

## Modelo de ameaça e princípios

Ativos críticos: PII de clientes, pedidos, preços internos, estoque, referências
de pagamento, idempotência, integrações e auditoria. Princípios: least privilege,
deny by default, acesso server-side, validação em todas as bordas, redaction,
separação de ambientes e defense in depth com RLS.

## Fluxo de acesso

```text
Browser --HTTPS/cookie--> Next.js --runtime role--> PostgreSQL
Admin ---auth + RBAC----> Next.js --admin use cases--> PostgreSQL
Workers ----------------> PostgreSQL (worker role)
Migrations -------------> PostgreSQL (owner/direct, fora do runtime)
```

O browser não recebe `DATABASE_URL`, `DIRECT_URL`, password, service role ou
consumer/provider secret. Route Handlers validam sessão, ownership e payload.

## Roles propostas

- `persi_migration_owner`: DDL, somente pipeline/manual aprovado.
- `persi_app`: DML necessário aos casos de uso, sem DDL/BYPASSRLS.
- `persi_worker`: inbox/outbox/jobs e operações de domínio autorizadas.
- `persi_readonly`: suporte/analytics com views redigidas quando necessário.
- roles de pessoas não compartilham credenciais da aplicação.

Segredos ficam no ambiente/secret manager, com rotação e escopo por ambiente.
Certificados Inter permanecem apenas no servidor. Payloads não carregam secrets.

## Matriz de acesso conceitual

| Entidade | Browser público | Cliente autenticado | Admin autorizado | Server/worker |
| --- | --- | --- | --- | --- |
| products/categories/brands/public media | via Next, leitura publicada | via Next | CRUD por permissão | CRUD |
| PIM/SEO público | via projeção Next | via Next | CRUD por permissão | CRUD |
| prices públicos | via Next, lista publicada | via Next | CRUD controlado | CRUD |
| inventory | não | disponibilidade agregada via Next | leitura/ajuste por função | CRUD transacional |
| customers/addresses | não | próprios via Next | suporte limitado | CRUD |
| carts | não direto | próprio via Next | suporte excepcional | CRUD |
| orders/order addresses | não | próprios via Next | vendas/financeiro/logística por coluna | CRUD |
| payments/transactions | não | status limitado via Next | financeiro limitado | CRUD |
| integration/inbox/outbox | não | não | operações controladas | CRUD |
| audit_logs | não | não | auditoria read-only autorizada | insert/read restrito |

V1 recomenda não expor schemas transacionais ao Data API. Se uma futura feature
usar Data API, criar schema/view dedicado e policies específicas; nunca
`USING (true)` em tabela sensível.

## RLS design

- RLS habilitada nas tabelas sensíveis mesmo quando a role runtime normalmente
  acessa pelo servidor; policies são explícitas por role.
- Cliente somente pode ver customer/order/cart cujo principal interno tenha sido
  resolvido e corresponda ao owner. JWT claims externas não viram SQL sem
  validação/mapeamento.
- Admin usa RBAC no caso de uso e role/policy compatível; service role não é
  atalho para telas administrativas.
- Inserts/updates usam `WITH CHECK`, não apenas `USING`.
- Audit, integrations, inventory e payment transactions não têm policy pública.
- Testes cobrem acesso cruzado entre dois customers e ausência de sessão.

Como a autenticação atual é WordPress/JWT, a primeira implementação pode manter
o banco totalmente server-only e RLS por roles técnicas. Policies por usuário
final só entram quando houver mecanismo seguro de propagar a identidade para a
transação. Supabase Auth não é assumido.

## LGPD e PII

- Coletar somente dados necessários ao contrato, entrega, fiscal e antifraude.
- Email normalizado; CPF/CNPJ validado, cifrado quando retido e com hash keyed
  para lookup. Não indexar plaintext. Telefone normalizado.
- Endereço de cadastro pode ser editado; snapshot do pedido segue retenção legal.
- Logs, audit metadata, webhook/outbox e errors não contêm documento, segredo,
  cartão, token, endereço completo ou payload bruto sem justificativa.
- Export/anonymization futura usa workflow auditado. Anonimização substitui PII
  não obrigatória, preserva totais e referências fiscais necessárias e rompe
  links de perfil quando legalmente permitido.
- Política de retenção por classe será aprovada com jurídico/contábil antes de
  production; não há exclusão cega de pedidos.

## Pagamentos e webhooks

- Nunca armazenar PAN completo, CVV, certificado, private key ou access token.
- Guardar token/reference do PSP, últimos dígitos/bandeira somente se permitidos
  e necessários.
- Validar autenticidade do webhook conforme provider, limitar body/tamanho,
  persistir inbox antes do ACK e deduplicar.
- Payload completo somente cifrado e com TTL quando indispensável para disputa;
  padrão é payload mínimo normalizado + hash.
- Comparações de assinatura usam operação constant-time quando aplicável.

## Aplicação e SQL

- Queries parametrizadas; allowlist para sort/filter; limites de paginação.
- Transações curtas; timeouts; locks em ordem determinística.
- HTML externo sanitizado no ponto de renderização.
- Erros públicos têm códigos estáveis sem SQL/stack/provider detail.
- Rate limiting para login, checkout, cupom, busca abusiva e webhooks conforme
  risco; chaves de rate limit não armazenam IP cru quando não necessário.

## Auditoria e observabilidade segura

Eventos críticos incluem actor, action, entity, correlation ID, timestamp UTC,
outcome e metadata allowlisted. Logs estruturados usam IDs internos/externos
parciais, não PII. Acesso a logs é restrito e retenção definida.

Alertas: falha repetida de auth/webhook, divergência de reconciliação, oversell,
idempotency conflict, backlog inbox/outbox, erro de migration e conexão saturada.

## Verificações antes da Fase C/produção

- threat model e matriz aprovados;
- roles/RLS testadas localmente;
- secret scanning e `.env.example` sem valores;
- backups/restore e rotação de credenciais ensaiados;
- extensões e schemas expostos do Supabase inventariados;
- logs testados com payloads contendo PII para confirmar redaction;
- nenhum deploy automático de banco para production.
