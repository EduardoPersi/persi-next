# Identificação no checkout Next

## Fluxo

- Sessão JWT válida: `/checkout` busca perfil/endereços e abre o checkout.
- Visitante: renderiza somente o gate de e-mail.
- E-mail novo: abre checkout guest e preenche `contact.email`.
- E-mail existente: oferece senha ou código de seis dígitos.
- Senha/OTP válido: o WordPress delega a emissão ao plugin JWT oficial; o
  Next grava o token no cookie `__Host-persi_jwt_session` e atualiza a página.

O `Cart-Token` não é lido, substituído nem expirado pelas rotas de identidade.
Assim, o carrinho guest corrente permanece depois do login; não há merge
silencioso com carrinho histórico.

## Segurança

As chamadas navegador → Next são same-origin, validam `Origin`/`Referer`, tipo
de conteúdo, tamanho e contrato fechado. As chamadas Next → WordPress usam
HMAC-SHA256 com timestamp, nonce anti-replay, rota, fingerprint anonimizado e
corpo. Configure o mesmo segredo privado nos dois ambientes:

```text
PERSI_HEADLESS_CHECKOUT_AUTH_SECRET=<segredo aleatório de 32+ caracteres>
PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID=primary
```

No WordPress:

```php
define( 'PERSI_HEADLESS_CHECKOUT_AUTH_SECRET', '<mesmo segredo>' );
define( 'PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID', 'primary' );
define( 'PERSI_CHECKOUT_LOGIN_CODE_TTL_MINUTES', 10 );
```

O TTL padrão é 10 minutos e o valor configurável é limitado entre 5 e 15.
O código usa `random_int`, `wp_hash_password` e `wp_check_password`, nunca é
salvo ou logado em texto puro e é apagado no sucesso, expiração ou quinto erro.

## Endpoints

Next same-origin:

- `POST /api/checkout-auth/identify`
- `POST /api/checkout-auth/password`
- `POST /api/checkout-auth/code/request`
- `POST /api/checkout-auth/code/verify`

WordPress, somente HMAC:

- `POST /wp-json/persi-headless/v1/checkout-auth/identify`
- `POST /wp-json/persi-headless/v1/checkout-auth/health` (somente HMAC, sem consultar usuários)
- `POST /wp-json/persi-headless/v1/checkout-auth/password`
- `POST /wp-json/persi-headless/v1/checkout-auth/code/request`
- `POST /wp-json/persi-headless/v1/checkout-auth/code/verify`

## E-mail, limites e refresh

O envio usa `wp_mail`, aproveitando a infraestrutura WordPress/WooCommerce. O
reenvio tem cooldown server-side de 60 segundos e limite adicional por e-mail
e fingerprint anonimizado. A validação admite cinco erros por código.

A tela OTP guarda em `sessionStorage` somente o e-mail e o instante do
cooldown; senha, código e JWT nunca são persistidos no navegador. Um refresh
restaura a etapa OTP e exige que o código seja digitado novamente.

## Rollback

1. Reverter os componentes e Route Handlers do gate no Next.
2. Reverter o `persi-headless` para 0.5.3 ou desabilitar `checkout_auth`.
3. Remover as duas variáveis privadas de HMAC dos ambientes.

O rollback não exige alteração de banco: OTP usa metadados de usuário e
transients. Não alterar Cloudflare nem ativar checkout híbrido.

## Riscos e validação em staging

A UX revela se um e-mail está cadastrado por decisão de produto. HMAC impede
consulta direta ao WordPress e os limites reduzem enumeração em massa, mas não
eliminam essa revelação na interface. O fluxo também depende do plugin JWT
oficial e da entrega de `wp_mail`; ambos devem estar saudáveis em staging.

Antes de produção, validar com WordPress/WooCommerce reais: conta logada, guest,
senha correta/incorreta, envio e entrega do OTP, cinco erros, expiração, reuso,
429 no cooldown, refresh do OTP, prefill e permanência do mesmo `Cart-Token` e
dos mesmos itens depois de senha e OTP. Conferir mobile e teclado. Não registrar
e-mail, senha, código, documento, cookies ou JWT durante esses testes.
