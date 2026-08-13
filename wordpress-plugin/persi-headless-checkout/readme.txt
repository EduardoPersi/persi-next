=== Persi Headless Checkout ===
Contributors: persimateriais
Requires at least: 6.4
Requires PHP: 7.4
Stable tag: 0.5.4
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
  endereço já digitados no Next.js, quando enviados — billingAddress/
  shippingAddress são opcionais em conjunto: ausentes quando a transferência
  parte direto do carrinho, sem passar pelas etapas de Perfil/Endereço, o
  checkout nativo coleta contato e endereço do zero nesse caso.
* Guarda o Cart-Token original na sessão do WooCommerce e o copia como
  meta_data (_persi_checkout_owner_token) do pedido assim que ele é criado
  pelo checkout nativo, para a tela de confirmação do Next.js reconhecer o
  dono do pedido.
* Redireciona o cliente de volta ao Next.js (?provider=woocommerce&orderId=)
  assim que o pedido é recebido, se PERSI_HEADLESS_CHECKOUT_CONFIRMATION_URL
  estiver configurada.
* Usa aquisição atômica e impede dois consumos concorrentes.
* Preserva um snapshot básico do carrinho para recuperação em caso de falha.
* Reaplica cupons recebidos e exige que o WooCommerce os valide e recalcule.
* Não fixa o frete transferido; o checkout nativo recalcula as opções.
* Não processa pagamentos.
* Autoriza a inicialização do WC Smart Checkout no backend
  `loja.persimateriais.com.br` sem alterar o plugin de terceiros.
* Preserva a tela de identificação por e-mail e o guest checkout configurado
  pelo próprio WC Smart Checkout.

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
define(
    'PERSI_HEADLESS_CHECKOUT_CONFIRMATION_URL',
    'https://persimateriais.com.br/checkout/confirmacao'
);

O segredo também pode ser fornecido pela variável de ambiente
PERSI_HEADLESS_CHECKOUT_HMAC_SECRET. A constante tem precedência.
O Key ID não diferencia letras maiúsculas e minúsculas.

Se PERSI_HEADLESS_CHECKOUT_CART_URL não existir, o plugin usa a URL retornada
por wc_get_cart_url(). Uma constante presente, mas inválida, não usa fallback
e gera um aviso administrativo.

Se PERSI_HEADLESS_CHECKOUT_CONFIRMATION_URL não existir, o cliente não é
redirecionado de volta ao Next.js — permanece na própria página de pedido
recebido do WooCommerce (degradação segura). Uma constante presente, mas
inválida, também não redireciona e gera um aviso administrativo.

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
