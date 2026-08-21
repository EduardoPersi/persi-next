=== Persi Headless ===
Contributors: persi
Tags: woocommerce, headless, rest-api
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.6.0
License: GPLv2 or later

Integração oficial e independente do tema entre WooCommerce e o frontend Next.js da Persi.

== Changelog ==

= 0.6.0 =
* Adiciona identificação protegida do checkout por e-mail, senha ou OTP.
* Reutiliza o emissor JWT oficial, aplica HMAC, rate limit, cooldown e código de uso único.

= 0.5.3 =
* Desacopla a versão do banco da versão funcional do plugin.
* Executa upgrades de esquema somente no admin e com lock atômico.
* Preserva explicitamente REST, wc-ajax, wc-api e admin-ajax no storefront lockdown.

== Installation ==

1. Faça backup e instale primeiro em homologação.
2. Envie persi-headless.zip em Plugins > Adicionar plugin.
3. Ative manualmente.
4. Configure WooCommerce > Persi Headless.
5. Não ative o order bump; ele é apenas uma estrutura reservada.

== REST API ==

GET /wp-json/persi/v1/products/{id}/family
GET /wp-json/persi/v1/products/{id}/bought-together
POST /wp-json/persi/v1/stock-notifications/subscribe
GET /wp-json/persi/v1/stock-notifications/confirm/{token}
GET /wp-json/persi/v1/stock-notifications/unsubscribe/{token}
POST /wp-json/persi/v1/newsletter/subscribe
GET /wp-json/persi/v1/newsletter/confirm/{token}
GET /wp-json/persi/v1/newsletter/unsubscribe/{token}
POST /wp-json/persi/v1/contact/submit
POST /wp-json/persi-headless/v1/checkout-auth/identify
POST /wp-json/persi-headless/v1/checkout-auth/password
POST /wp-json/persi-headless/v1/checkout-auth/code/request
POST /wp-json/persi-headless/v1/checkout-auth/code/verify

As rotas GET retornam somente produtos publicados e dados públicos. A inscrição
retorna mensagem neutra, usa honeypot, rate limit e double opt-in por padrão.

== Identificação do checkout ==

Configure no Next e no wp-config.php um segredo exclusivo com no mínimo 32 caracteres:

define( 'PERSI_HEADLESS_CHECKOUT_AUTH_SECRET', 'substitua-por-segredo-forte' );
define( 'PERSI_HEADLESS_CHECKOUT_AUTH_KEY_ID', 'primary' );
define( 'PERSI_CHECKOUT_LOGIN_CODE_TTL_MINUTES', 10 );

As quatro rotas só aceitam chamadas HMAC do servidor Next. O endpoint de
identificação revela apenas `exists`; senha e OTP devolvem o JWT somente ao
Next, que o grava no cookie HttpOnly existente. O OTP tem seis dígitos, fica
armazenado apenas como hash, expira em 10 minutos por padrão, aceita no máximo
cinco erros, tem cooldown de 60 segundos e é apagado depois do uso.

== Compatibility ==

Mínimos declarados: WordPress 6.4, WooCommerce 8.2 e PHP 7.4. Usa somente APIs
públicas do WooCommerce, é compatível com HPOS por não consultar tabelas de
pedidos, e reutiliza o Action Scheduler fornecido pelo WooCommerce.

== Uninstall ==

A desinstalação remove configurações, mas preserva a tabela de inscrições para
evitar perda acidental de dados. A remoção definitiva deve seguir o processo de
retenção/LGPD da empresa.

== Segurança das notificações de estoque ==

Configure no wp-config.php ou no ambiente do servidor:

define( 'PERSI_HEADLESS_STOCK_HMAC_SECRET', 'substitua-por-segredo-aleatorio-forte' );
define( 'PERSI_HEADLESS_STOCK_HMAC_KEY_ID', 'primary' );
define( 'PERSI_HEADLESS_STOCK_ALLOWED_ORIGINS', 'https://frontend.example' );
define( 'PERSI_HEADLESS_STOCK_FRONTEND_URL', 'https://frontend.example' );
define( 'PERSI_HEADLESS_STOCK_TRUST_PROXY_HEADERS', false );
define( 'PERSI_HEADLESS_STOCK_TRUSTED_PROXY_IPS', '' );

O segredo é exclusivo deste módulo e nunca deve usar NEXT_PUBLIC_. O Key ID não
diferencia letras maiúsculas e minúsculas. O consentimento registra versão e URL
da política, origem autenticada e hashes de IP/User-Agent, nunca valores brutos.

Retenção padrão antes da anonimização: pending 7 dias, sent 90 dias, failed e
unsubscribed 30 dias e confirmed 180 dias. A política deve ser revisada
juridicamente. Registros antigos sem consentimento comprovado são preservados,
mas não entram na fila até uma nova inscrição consentida.

Headers do Cloudflare só são aceitos quando TRUST_PROXY_HEADERS é true e o
REMOTE_ADDR pertence à lista explícita TRUSTED_PROXY_IPS. Mantenha false quando
a cadeia de proxy não tiver sido homologada.

== Segurança da newsletter ==

Módulo independente do de estoque, mesma arquitetura de assinatura HMAC e
double opt-in, mas com inscrição global por e-mail (sem produto/variação) e
sem fila de envio — este plugin apenas registra e confirma inscritos; o
disparo de campanhas fica a cargo de uma ferramenta de e-mail marketing que
consuma a lista depois.

Configure no wp-config.php ou no ambiente do servidor:

define( 'PERSI_HEADLESS_NEWSLETTER_HMAC_SECRET', 'substitua-por-segredo-aleatorio-forte' );
define( 'PERSI_HEADLESS_NEWSLETTER_HMAC_KEY_ID', 'primary' );
define( 'PERSI_HEADLESS_NEWSLETTER_ALLOWED_ORIGINS', 'https://frontend.example' );
define( 'PERSI_HEADLESS_NEWSLETTER_FRONTEND_URL', 'https://frontend.example' );
define( 'PERSI_HEADLESS_NEWSLETTER_TRUST_PROXY_HEADERS', false );
define( 'PERSI_HEADLESS_NEWSLETTER_TRUSTED_PROXY_IPS', '' );

O segredo é exclusivo deste módulo (não reutiliza o de estoque) e nunca deve
usar NEXT_PUBLIC_. Inscrições `pending` sem confirmação expiram em 7 dias;
inscrições `unsubscribed` são anonimizadas em 30 dias; inscrições `confirmed`
permanecem ativas indefinidamente até o próprio inscrito cancelar.

== Segurança do formulário de contato ==

Mesma arquitetura de assinatura HMAC dos módulos acima, mas sem tabela de
banco: a mensagem não é armazenada, só validada, limitada por taxa e
encaminhada por e-mail (`wp_mail`) ao destinatário configurado. A proteção
contra replay usa um transient (expira sozinho) em vez de nonce persistido.

Configure no wp-config.php ou no ambiente do servidor:

define( 'PERSI_HEADLESS_CONTACT_HMAC_SECRET', 'substitua-por-segredo-aleatorio-forte' );
define( 'PERSI_HEADLESS_CONTACT_HMAC_KEY_ID', 'primary' );
define( 'PERSI_HEADLESS_CONTACT_ALLOWED_ORIGINS', 'https://frontend.example' );
define( 'PERSI_HEADLESS_CONTACT_RECIPIENT_EMAIL', 'vendas@persimateriais.com.br' );
define( 'PERSI_HEADLESS_CONTACT_TRUST_PROXY_HEADERS', false );
define( 'PERSI_HEADLESS_CONTACT_TRUSTED_PROXY_IPS', '' );

O segredo é exclusivo deste módulo (não reutiliza os de estoque/newsletter) e
nunca deve usar NEXT_PUBLIC_. Sem `PERSI_HEADLESS_CONTACT_RECIPIENT_EMAIL`
configurado, as mensagens vão para o e-mail administrativo padrão do
WordPress.

== Fechar a vitrine ao público ==

Módulo opcional (desativado por padrão) que redireciona (301) qualquer
página pública deste WordPress para a primeira URL configurada em
"Origens do frontend" — exceto o checkout nativo (para onde o Next.js manda
o cliente de propósito durante o pagamento) e usuários com permissão de
gerenciar o WooCommerce, que continuam navegando normalmente para suporte e
conferência de pedidos.

REST API (/wp-json), wp-admin, uploads de mídia (wp-content) e as chamadas
wc-ajax do próprio checkout nunca passam pelo redirecionamento — só páginas
de tema (home, categoria, produto, busca, minha conta, carrinho etc.) são
afetadas. Ative depois de confirmar que o checkout nativo está funcionando
de ponta a ponta.
