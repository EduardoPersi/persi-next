# Auditoria da migração de autenticação JWT

## Escopo

Esta auditoria corresponde à Fase 1 da migração para uma sessão única baseada
em JWT. Nenhum fluxo de autenticação foi removido nesta fase.

## Estado atual

O projeto mantém duas camadas de sessão em convivência:

1. cookie opaco `__Host-persi_account_session`, emitido pelo plugin
   `persi-headless-account` e persistido em `persi_account_sessions`;
2. sessão JWT interna do NextAuth, que transporta o mesmo token opaco do
   WordPress nos campos `wpSessionToken`, `wpSessionExpiresAt` e `customer`.

O JWT interno do NextAuth não é o JWT emitido pelo endpoint
`/wp-json/jwt-auth/v1/token`. Portanto, apesar do nome da estratégia do
NextAuth, a aplicação ainda não utiliza a autenticação JWT do WordPress.

## Fluxos encontrados

### E-mail ou usuário e senha

`AccountLoginForm` chama o contexto `useAccount`, que envia a credencial para
`POST /api/account/login`. A rota assina a requisição com HMAC e chama
`/wp-json/persi-account/v1/login`. O WordPress cria um token opaco no
`SessionRepository`, e o Next.js o grava no cookie principal.

Existe também um provider Credentials em `auth.ts` que chama o mesmo serviço
HMAC. Esse caminho é concorrente ao formulário principal.

### Google e Facebook

Os callbacks próprios em `/api/auth/google/callback` e
`/api/auth/facebook/callback` validam o provedor no servidor Next.js. Em
seguida, enviam a identidade normalizada para
`/wp-json/persi-headless-account/v1/oauth-login`, protegida por HMAC. O
WordPress vincula/cria o usuário e emite o mesmo token opaco.

Também existe configuração Google/Facebook em `auth.ts`, com callbacks do
NextAuth que repetem a criação da sessão opaca. Isso representa uma segunda
orquestração OAuth e deve ser consolidado.

### Consumo da sessão

`services/account/serverSession.ts` procura primeiro o cookie opaco e depois a
sessão NextAuth. O helper é consumido pelo painel, checkout e APIs internas.

Foram encontrados:

- 15 arquivos que consomem `getServerAccountToken`;
- 18 arquivos que consomem `getServerAccountSession`;
- 8 serviços que usam `requestAccountEndpoint` com assinatura HMAC;
- 6 arquivos com o header `x-persi-session`;
- 13 arquivos que referenciam o cookie atual;
- 13 arquivos ligados ao `RequestAuthenticator` do plugin;
- 8 referências ao `SessionService` e 4 ao `SessionRepository`.

Pedidos, workspace, perfil, endereços, contas conectadas, listas e lista de
espera ainda dependem do token opaco e/ou da assinatura HMAC. A remoção desses
componentes antes da migração dos consumidores quebraria o painel do cliente.

## Cookie e logout

O cookie atual já usa `HttpOnly`, `SameSite=Lax` e `Path=/`; `Secure` é ativado
em produção. Ele deverá manter essas propriedades, mas passará a guardar apenas
o JWT do WordPress.

O botão de logout da página já redireciona para `/entrar`. O drawer chama apenas
o método do contexto. Os dois caminhos precisam usar a mesma operação, limpar o
estado React e caches associados, substituir a rota por `/entrar` e atualizar a
árvore de Server Components.

## Restrição de segurança do OAuth social

O endpoint padrão `/jwt-auth/v1/token` exige `username` e `password`. Google e
Facebook não fornecem a senha do usuário WordPress. Logo, um callback social
não consegue usar esse endpoint diretamente.

Remover o HMAC e manter um endpoint público que confie somente em e-mail,
provider e provider ID enviados pelo Next.js permitiria falsificação de
identidade. A migração social precisa adotar uma destas estratégias seguras:

1. o WordPress recebe e valida diretamente a credencial assinada do provedor
   (ID token Google ou access token Facebook), resolve o usuário e então emite
   o JWT com a mesma configuração do plugin JWT; ou
2. o callback OAuth passa a ocorrer integralmente no WordPress, que valida o
   provedor e devolve ao Next.js um código de uso único para troca por JWT.

A primeira opção preserva as rotas e a experiência OAuth atuais no Next.js e é
a recomendada para esta migração. O material sensível do provedor permanece
somente entre servidores e nunca é gravado em cookie ou retornado ao navegador.

## Arquitetura-alvo recomendada

```text
Credenciais ──> /jwt-auth/v1/token ───────────┐
                                               │
Google ──> callback Next ──> validação WP ─────┼──> JWT WordPress
                                               │        │
Facebook ─> callback Next ─> validação WP ─────┘        v
                                             cookie HttpOnly único
                                                        │
                                                        v
                                           sessão/usuário/middleware
```

Depois da emissão, nenhum objeto público de sessão deve armazenar ou expor o
método de login. Todos os consumidores devem receber apenas o usuário derivado
de um JWT válido.

## Ordem segura da migração

1. Criar a camada `lib/auth` com tipos, cookies, cliente JWT, validação,
   usuário, sessão e erros.
2. Migrar e testar credenciais para `/jwt-auth/v1/token` sem converter o valor
   digitado.
3. Adaptar leitura de sessão e `users/me` para `Authorization: Bearer`.
4. Migrar logout e unificar os componentes clientes com redirecionamento para
   `/entrar`.
5. Implementar a troca social segura no plugin WordPress, preservando a
   validação OAuth existente e emitindo o mesmo JWT.
6. Migrar pedidos, workspace, perfil, endereços, listas, lista de espera e
   demais APIs para autorização Bearer.
7. Migrar proteção de rotas sem criar um segundo middleware.
8. Validar alternância entre todos os métodos e múltiplas abas/navegadores.
9. Somente então remover SessionRepository, HMAC, rotas legadas, diagnósticos e
   tipos não utilizados.

## Riscos e validações obrigatórias

- Confirmar compatibilidade/licença e API disponível na versão instalada do
  plugin `JWT Authentication for WP REST API` antes de emitir JWT no fluxo
  social.
- Não decodificar JWT como substituto de validação de assinatura no servidor.
- Não registrar JWT, Authorization, cookies, senha ou tokens OAuth.
- Não expor o JWT em respostas JSON ao navegador; somente cookie HttpOnly.
- Confirmar expiração e estratégia de renovação suportada pelo backend. O
  plugin JWT padrão pode não oferecer refresh token nativo.
- Preservar proteção CSRF das mutações realizadas pelo Next.js.
- Não remover o legado enquanto qualquer consumidor listado continuar usando
  `x-persi-session` ou assinatura HMAC.
