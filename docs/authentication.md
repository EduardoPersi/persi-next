# Autenticação JWT

## Arquitetura final

O plugin **JWT Authentication for WP-API**, de Enrique Chavez, é a única
implementação responsável por emitir, assinar e validar JWT. O plugin Persi não
usa Firebase diretamente, não acessa `JWT_AUTH_SECRET_KEY` para operações
criptográficas e não mantém emissor, decoder, validator, refresh ou lista de
revogação próprios.

```text
Credenciais ─────────────────────────────> POST /jwt-auth/v1/token ─┐
Google/Meta -> validação Persi -> usuário -> OfficialJwtAdapter ────┤
                                                                    v
                                                   emissor JWT oficial
                                                                    │
                                                Bearer nas APIs privadas
```

Para login social, `OfficialJwtAdapter` cria credenciais aleatórias apenas em
memória, instala durante a chamada um filtro `authenticate` restrito a esses
valores e faz uma requisição REST interna a `/jwt-auth/v1/token`. Assim, o
usuário já validado pelo Google/Meta entra no fluxo público do emissor oficial;
nenhuma senha ou token temporário é salvo.

`OfficialJwtResponseMetadata` apenas observa os filtros públicos
`jwt_auth_token_before_sign` e `jwt_auth_token_before_dispatch` para acrescentar
`expires_at` à resposta. Ele não altera o payload, não assina e não decodifica o
JWT.

## Responsabilidades

- Plugin oficial: emissão, assinatura, algoritmo, secret, expiração e validação.
- Plugin Persi: valida Google/Meta, resolve/cria usuário WordPress, integra o
  usuário social ao endpoint oficial e autoriza endpoints privados pelo usuário
  que o plugin oficial associou ao Bearer.
- Next.js `lib/auth`: transporte servidor-servidor, cookie HttpOnly e consulta
  aos endpoints oficiais. Não decodifica nem valida criptograficamente JWT.
- Camada de negócio: recebe o JWT no servidor e envia
  `Authorization: Bearer <JWT>`; componentes não conhecem autenticação.

## Endpoints

Autenticação:

- `POST /wp-json/jwt-auth/v1/token` — emissão oficial por credenciais e, via
  adapter interno, por identidade social já validada.
- `POST /wp-json/jwt-auth/v1/token/validate` — validação oficial.
- `POST /wp-json/persi-auth/v1/oauth/token` — valida Google/Meta, resolve o
  usuário e delega a emissão ao endpoint oficial.
- `GET /wp-json/persi-auth/v1/me` — Bearer validado pelo plugin oficial.
- `GET /wp-json/persi-auth/v1/health` — estado não sensível das dependências e
  configurações, versões do PHP, WordPress, plugin Persi e plugin JWT;
  disponível mesmo quando JWT ou WooCommerce estão indisponíveis.

Negócio protegido por Bearer:

- `GET /wp-json/persi-account/v1/orders`
- `GET /wp-json/persi-account/v1/orders/{id}`
- `GET /wp-json/persi-account/v1/workspace`
- `GET|PUT /wp-json/persi-account/v1/profile`
- `GET /wp-json/persi-account/v1/addresses`
- `PUT|DELETE /wp-json/persi-account/v1/addresses/{type}`
- `PUT /wp-json/persi-account/v1/addresses/{type}/primary`
- `GET /wp-json/persi-account/v1/connected-accounts`
- `GET /wp-json/persi-account/v1/stock-notifications`
- `DELETE /wp-json/persi-account/v1/stock-notifications/{id}`
- endpoints `/wp-json/persi-headless/v1/customer-lists/*`

## Sessão e logout

Existe somente o cookie `__Host-persi_jwt_session`, com `HttpOnly`, `Secure`,
`SameSite=Lax` e `Path=/`. O método de login não é guardado na sessão.

`POST /api/account/logout` apaga o cookie, limpa o contexto React, comunica as
outras abas e redireciona para `/entrar`. O endpoint Persi de revogação foi
removido para não acrescentar um segundo validator. Como JWT é stateless e a
edição oficial usada não oferece revogação/refresh, um token copiado antes do
logout continua válido até a expiração definida pelo plugin oficial.

## Guia de migração

1. Fazer backup do banco e do plugin atual.
2. Confirmar que **JWT Authentication for WP-API** está ativo e que `/token` e
   `/token/validate` respondem corretamente.
3. Manter `JWT_AUTH_SECRET_KEY` exclusivamente no `wp-config.php`; o plugin
   Persi apenas verifica que a constante existe.
4. Configurar `PERSI_GOOGLE_CLIENT_ID`, `PERSI_FACEBOOK_APP_ID`,
   `PERSI_FACEBOOK_APP_SECRET`, `PERSI_FACEBOOK_GRAPH_VERSION` e origens.
5. Confirmar OpenSSL e encaminhamento do header `Authorization` ao PHP.
6. Instalar manualmente o ZIP somente em homologação; este repositório não faz
   instalação ou deploy.
7. Publicar o Next.js compatível, limpar cookies antigos e testar credenciais,
   Google, Meta, logout, múltiplas abas e todas as áreas privadas.
8. Remover qualquer versão anterior do plugin Persi que ainda contenha
   `JwtIssuer.php`, `RevokedTokenStore.php` ou `LogoutController.php`.

## Diagnóstico

`scripts/test-jwt.ts` é uma ferramenta local de desenvolvimento. Sua leitura
sem assinatura existe apenas para exibir metadados durante diagnóstico; ela não
é importada pelo runtime de autenticação e nunca emite ou valida tokens.
