# Incidente do serviço de identificação

Data da investigação: 21 de agosto de 2026.

## Evidências de produção

`POST https://loja.persimateriais.com.br/wp-json/persi-headless/v1/checkout-auth/identify`
sem assinatura respondeu HTTP 404 `rest_no_route`. Uma rota instalada deveria
responder 401 na mesma sonda, pois o `permission_callback` HMAC seria executado.

O índice `GET /wp-json/` listou as rotas antigas `/persi/v1/*`, mas nenhuma
rota contendo `checkout-auth`. Isso confirma que o `persi-headless` está ativo,
porém o runtime não carregou o módulo 0.6.0. As causas operacionais possíveis
são ZIP antigo ainda instalado, módulo explicitamente desativado ou falha PHP
no carregamento; a versão instalada não é exposta publicamente para distinguir
essas três possibilidades.

`POST https://persimateriais.com.br/api/checkout-auth/identify` respondeu HTTP
503. No ambiente local usado para preparar o deploy, `WORDPRESS_URL` está
configurado, mas `PERSI_HEADLESS_CHECKOUT_AUTH_SECRET` e
`PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID` estão ausentes. Isso comprova a falta
local; a presença no runtime Hostinger precisa ser conferida no painel, sem
mostrar o segredo.

## Correção operacional na Hostinger

1. Fazer backup do WordPress e do plugin atual.
2. Instalar manualmente o ZIP `wordpress-plugin/persi-headless.zip` e confirmar
   no painel que a versão ativa é 0.6.0.
3. Confirmar que o módulo `checkout_auth` não está explicitamente desativado.
4. Adicionar ao `wp-config.php`, antes de "That's all":

```php
define( 'PERSI_HEADLESS_CHECKOUT_AUTH_SECRET', '<segredo-aleatório-de-32-ou-mais-caracteres>' );
define( 'PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID', 'primary' );
define( 'PERSI_CHECKOUT_LOGIN_CODE_TTL_MINUTES', 10 );
```

5. Configurar no runtime Next da Hostinger exatamente o mesmo segredo e key ID:

```text
WORDPRESS_URL=https://loja.persimateriais.com.br
PERSI_HEADLESS_CHECKOUT_AUTH_SECRET=<mesmo-segredo>
PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID=primary
PERSI_HEADLESS_ACCOUNT_ORIGIN=https://persimateriais.com.br
```

6. Reiniciar/republicar o processo Next para carregar as variáveis. Não usar
   `NEXT_PUBLIC_` e não imprimir o segredo.
7. Consultar `GET /api/checkout-auth/health`. Exigir HTTP 200,
   `checkoutAuthConfigured=true`, `wordpressReachable=true`,
   `hmacVerified=true` e `pluginVersion=0.6.0`.
8. Validar um e-mail novo e um e-mail existente em staging.

## Assinatura e relógio

Next e PHP assinam, nessa ordem: timestamp em segundos, nonce UUID novo, método
`POST`, rota REST sem `/wp-json`, fingerprint anonimizado e corpo JSON bruto.
O corpo enviado é exatamente o corpo assinado. A janela é 300 segundos; não
foi ampliada. Sincronizar os relógios dos dois runtimes via NTP se o health
retornar 401 com categoria de timestamp.

Cada chamada gera nonce novo. O WordPress grava somente seu SHA-256 em transient
por cinco minutos. Falha de banco ao consultar/gravar transient pode afetar a
proteção e deve ser correlacionada com os erros MySQL já observados.

## Observabilidade

Falhas agora registram no servidor Next somente endpoint, status, duração,
categoria, flags de configuração e key ID. E-mail, segredo, assinatura, nonce,
senha, OTP, JWT e cookies não entram no log. Redirect não é seguido; 301/302,
401, 403, 404, 500, timeout e rede possuem categorias distintas.
