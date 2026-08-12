=== Persi Headless Checkout ===
Contributors: persimateriais
Requires at least: 6.4
Requires PHP: 7.4
Stable tag: 0.3.0
License: Proprietary

Núcleo seguro e incremental para transferências temporárias de checkout headless.

== Escopo desta versão ==

* Registra POST /wp-json/persi-headless/v1/checkout-transfer.
* Valida contrato JSON estrito e limite de 32 KiB.
* Autentica requisições com HMAC SHA-256.
* Impede replay por nonce único.
* Persiste somente o hash SHA-256 do token temporário.
* Retorna uma URL baseada em wc_get_checkout_url().
* Consome o token somente na página base do checkout.
* Restaura produtos simples e variações comuns após pré-validação completa.
* Pré-preenche cobrança e entrega (WC()->customer) com os dados de contato e
  endereço já digitados no Next.js, evitando redigitação no checkout nativo.
* Usa aquisição atômica e impede dois consumos concorrentes.
* Preserva um snapshot básico do carrinho para recuperação em caso de falha.
* Não aplica cupons nem seleciona frete.
* Não processa pagamentos.

== Consumo do token ==

O consumo ocorre somente em:

/checkout/?persi_checkout_transfer=TOKEN

Endpoints internos, incluindo order-pay e order-received, são ignorados.
Em caso de sucesso, o carrinho é persistido e o cliente recebe um redirect
HTTP 303 para a URL retornada por wc_get_checkout_url(), sem o token.

Somente produtos simples e variações comuns são aceitos. Produtos que dependam
de cart_item_data adicional são rejeitados pelos hooks oficiais de validação
do WooCommerce antes que o carrinho atual seja esvaziado.

== Configuração local ==

Defina no wp-config.php, antes da linha que encerra a edição:

define( 'PERSI_HEADLESS_CHECKOUT_HMAC_SECRET', 'use-um-segredo-aleatorio-forte' );
define( 'PERSI_HEADLESS_CHECKOUT_HMAC_KEY_ID', 'primary' );
define( 'PERSI_HEADLESS_CHECKOUT_ALLOWED_ORIGINS', 'https://frontend.local' );
define(
    'PERSI_HEADLESS_CHECKOUT_CART_URL',
    'https://yellowgreen-ram-345959.hostingersite.com/carrinho'
);

O segredo também pode ser fornecido pela variável de ambiente
PERSI_HEADLESS_CHECKOUT_HMAC_SECRET. A constante tem precedência.
O Key ID não diferencia letras maiúsculas e minúsculas.

Se PERSI_HEADLESS_CHECKOUT_CART_URL não existir, o plugin usa a URL retornada
por wc_get_cart_url(). Uma constante presente, mas inválida, não usa fallback
e gera um aviso administrativo.

== Assinatura v1 ==

O valor assinado é UTF-8, sem newline final:

POST
/wp-json/persi-headless/v1/checkout-transfer
{X-Persi-Timestamp}
{X-Persi-Nonce}
{X-Persi-Origin normalizada em minúsculas e sem barra final}
{sha256 hexadecimal minúsculo do corpo bruto}

Calcule HMAC SHA-256 desse valor usando o segredo e envie:

X-Persi-Signature: v1={hmac hexadecimal minúsculo}

O timestamp é Unix em segundos e aceita diferença máxima de 120 segundos.
O nonce deve ser base64url com 22 a 128 caracteres e deve ser único.

== Testes ==

Sem instalar dependências:

php tests/run.php

Execute o comando a partir da raiz deste plugin.
