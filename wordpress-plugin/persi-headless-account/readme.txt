=== Persi Headless Account ===
Requires at least: 6.4
Requires PHP: 8.1
Stable tag: 1.0.4

APIs privadas da conta Persi protegidas por JWT emitido e validado
exclusivamente pelo plugin JWT Authentication for WP REST API.

== Requisitos ==

* WooCommerce e JWT Authentication for WP REST API ativos.
* `JWT_AUTH_SECRET_KEY` forte e header `Authorization` encaminhado ao PHP.
* Extensão OpenSSL do PHP.
* `PERSI_GOOGLE_CLIENT_ID`, `PERSI_FACEBOOK_APP_ID`,
  `PERSI_FACEBOOK_APP_SECRET` e `PERSI_FACEBOOK_GRAPH_VERSION` no wp-config.php.

== Endpoints ==

Públicos: registro, recuperação de senha e
`POST /wp-json/persi-auth/v1/oauth/token`.

Diagnóstico sem secrets: `GET /wp-json/persi-auth/v1/health`.

Pedidos, workspace, perfil, endereços, contas conectadas, notificações e listas
exigem `Authorization: Bearer <JWT>`.

Google é validado por assinatura RS256 com os certificados oficiais, issuer,
audience, expiração e e-mail verificado. Meta é validado com `debug_token`, App
ID, expiração e perfil oficial antes da integração com o emissor JWT oficial.

O plugin Persi não assina, decodifica nem valida JWT. Após validar Google ou
Meta e resolver o usuário, ele chama internamente `/jwt-auth/v1/token`; emissão,
assinatura, algoritmo, secret e validação pertencem exclusivamente ao plugin
JWT Authentication for WP REST API.
