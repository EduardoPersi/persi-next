=== Persi Headless ===
Contributors: persi
Tags: woocommerce, headless, rest-api
Requires at least: 6.4
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later

Integração oficial e independente do tema entre WooCommerce e o frontend Next.js da Persi.

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

As rotas GET retornam somente produtos publicados e dados públicos. A inscrição
retorna mensagem neutra, usa honeypot, rate limit e double opt-in por padrão.

== Compatibility ==

Mínimos declarados: WordPress 6.4, WooCommerce 8.2 e PHP 7.4. Usa somente APIs
públicas do WooCommerce, é compatível com HPOS por não consultar tabelas de
pedidos, e reutiliza o Action Scheduler fornecido pelo WooCommerce.

== Uninstall ==

A desinstalação remove configurações, mas preserva a tabela de inscrições para
evitar perda acidental de dados. A remoção definitiva deve seguir o processo de
retenção/LGPD da empresa.
