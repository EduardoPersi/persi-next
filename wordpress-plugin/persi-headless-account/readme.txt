=== Persi Headless Account ===
Contributors: persi
Requires at least: 6.4
Requires PHP: 8.1
WC requires at least: 8.2
Stable tag: 0.3.2
License: Proprietary

Núcleo de autenticação e sessões opacas para a futura Área da Conta headless.

== Escopo da versão 0.3.2 ==

Esta fase fornece exclusivamente:

* POST /wp-json/persi-account/v1/login
* GET /wp-json/persi-account/v1/session
* POST /wp-json/persi-account/v1/logout
* GET /wp-json/persi-account/v1/orders
* GET /wp-json/persi-account/v1/orders/{id}
* POST /wp-json/persi-account/v1/register
* POST /wp-json/persi-account/v1/forgot-password
* POST /wp-json/persi-account/v1/reset-password
* POST /wp-json/persi-account/v1/google-login
* autenticação HMAC entre servidores;
* proteção contra replay;
* limitação progressiva de tentativas de login;
* sessões opacas revogáveis;
* compatibilidade declarada com HPOS.

Não fornece cadastro, recuperação de senha, edição de perfil ou endereços,
checkout ou integração com gateways. A consulta de pedidos é somente leitura.

== Pedidos ==

Os endpoints de pedidos exigem HMAC e X-Persi-Session. O usuário é resolvido pela
sessão opaca e nunca por customer_id enviado pelo navegador. A listagem usa
wc_get_orders e o detalhe usa wc_get_order, preservando compatibilidade com HPOS.
Pedidos de convidado e pedidos pertencentes a outro usuário não são retornados.

== Configuração ==

Configure no wp-config.php ou como variáveis de ambiente do servidor:

define( 'PERSI_HEADLESS_ACCOUNT_HMAC_SECRET', 'substitua-por-um-segredo-aleatorio-forte' );
define( 'PERSI_HEADLESS_ACCOUNT_HMAC_KEY_ID', 'primary' );
define(
    'PERSI_HEADLESS_ACCOUNT_ALLOWED_ORIGINS',
    'https://yellowgreen-ram-345959.hostingersite.com'
);

O segredo deve ser diferente do segredo do Persi Headless Checkout e nunca deve
usar prefixo NEXT_PUBLIC_. Sem segredo ou key ID, os endpoints recusam a operação.
O Key ID não diferencia letras maiúsculas e minúsculas.

O login Google usa o `sub` validado pelo Next.js como identificador permanente.
O plugin armazena somente HMAC-SHA256 determinístico do `sub` e do e-mail na
tabela dedicada de identidades. Nenhum access token, refresh token, ID token ou
Client Secret do Google é recebido ou persistido pelo WordPress.

PERSI_HEADLESS_ACCOUNT_ALLOWED_ORIGINS aceita uma lista separada por vírgulas.
Cada origem deve conter apenas esquema HTTP/HTTPS, host e porta opcional, sem
caminho, query, fragmento ou credenciais.

Por padrão, apenas REMOTE_ADDR é considerado para limitação por IP. Ative
PERSI_HEADLESS_ACCOUNT_TRUST_PROXY_HEADERS somente depois de confirmar que o
proxy confiável substitui e remove cabeçalhos enviados diretamente pelo cliente.

== Contrato HMAC ==

Todos os endpoints exigem:

* X-Persi-Key-Id
* X-Persi-Timestamp (Unix em segundos)
* X-Persi-Nonce (base64url aleatório)
* X-Persi-Origin
* X-Persi-Signature

A string canônica é, sem newline final:

{METHOD}
{PATH}
{TIMESTAMP}
{NONCE}
{ORIGIN_NORMALIZADA}
{SHA256_HEX_MINUSCULO_DO_CORPO_BRUTO}

Exemplo para login:

POST
/wp-json/persi-account/v1/login
{timestamp}
{nonce}
https://yellowgreen-ram-345959.hostingersite.com
{body_sha256}

A assinatura é HMAC-SHA256 hexadecimal minúscula e o header usa:

X-Persi-Signature: v1={assinatura}

O timestamp aceita diferença máxima de 120 segundos. O nonce é consumido uma
única vez e permanece reservado por 5 minutos.

== Login ==

Corpo JSON exato:

{
  "identifier": "email-ou-usuario",
  "password": "senha",
  "remember": false
}

Propriedades desconhecidas são rejeitadas. A senha é enviada apenas na chamada
HMAC servidor a servidor, usada por wp_authenticate e nunca persistida ou
registrada em log.

Uma resposta bem-sucedida contém um sessionToken opaco. Somente o hash SHA-256
do token é persistido. O servidor Next.js deverá futuramente guardar o token em
cookie HttpOnly; esta versão não cria esse cookie.

== Sessão ==

GET /session exige X-Persi-Session. A resposta informa se a sessão está
autenticada e devolve somente perfil seguro, sem customer_id confiado pelo
navegador.

Prazos:

* remember=false: inatividade de 2 horas, limite absoluto de 24 horas;
* remember=true: inatividade de 7 dias, limite absoluto de 30 dias.

A atividade renova somente o prazo de inatividade e nunca ultrapassa o limite
absoluto. Logout revoga a sessão e é idempotente.

== Limitação de tentativas ==

O login é limitado por identificador normalizado e por impressão HMAC do IP.
São permitidas até 5 falhas em uma janela de 15 minutos. A partir daí é aplicado
bloqueio progressivo iniciado em 30 segundos, limitado a 15 minutos, com
Retry-After. E-mail, usuário e IP puros não são gravados na tabela de limites.

== Testes ==

Em um ambiente com PHP 8.1 ou superior:

php tests/run.php

Também execute lint nos arquivos:

php -l persi-headless-account.php
php -l uninstall.php

e em todos os arquivos PHP de src/ e tests/.

Os testes unitários locais usam stubs de WordPress e banco em memória. A
instalação via dbDelta, concorrência real do MySQL e integração com
wp_authenticate devem ser homologadas em uma instalação de teste do WordPress.

== Desinstalação ==

Por segurança operacional, uninstall.php remove somente a opção de versão. As
tabelas e sessões são preservadas para não apagar dados automaticamente.
