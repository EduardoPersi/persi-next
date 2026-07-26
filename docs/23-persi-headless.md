# Persi Headless

## Escopo

Plugin WordPress independente do tema em `wordpress-plugin/persi-headless`.
Não altera WoodMart, WooCommerce, checkout, pagamento ou tabelas internas do
WooCommerce. O order bump permanece desabilitado e sem hooks.

## Requisitos declarados

- WordPress 6.4 ou superior;
- WooCommerce 8.2 ou superior;
- PHP 7.4 ou superior;
- WordPress REST API;
- Action Scheduler fornecido pelo WooCommerce.

O plugin usa `wc_get_product()` e métodos CRUD públicos. Não consulta pedidos,
portanto não depende do formato de armazenamento e é compatível por desenho com
HPOS. As versões reais da hospedagem devem ser conferidas em homologação.

## Contratos públicos

`GET /wp-json/persi/v1/products/{product_id}/family`

Retorna `family`, `currentProductId` e `items`. Cada item contém `productId`,
`name`, `slug`, `href`, atributos globais reais, imagem pública, `inStock`,
`purchasable` e `isCurrent`. Produtos sem família retornam 404 controlado.

`GET /wp-json/persi/v1/products/{product_id}/bought-together`

Retorna `productId` e `items`. Cada item contém ID, nome, slug, href, preço
público, moeda, imagem, estoque, capacidade de compra e quantidade sugerida.
Nenhum desconto ou acréscimo automático ao carrinho é realizado.

`POST /wp-json/persi/v1/stock-notifications/subscribe`

```json
{
  "productId": 123,
  "variationId": 456,
  "email": "cliente@exemplo.com",
  "website": ""
}
```

A resposta de sucesso é neutra (`202`) para evitar enumeração. O endpoint
valida Content-Type, tamanho, honeypot, e-mail, publicação, vínculo da variação,
indisponibilidade e limite por IP anonimizado.

Confirmação e cancelamento usam tokens aleatórios, longos e armazenados como
SHA-256:

- `GET /wp-json/persi/v1/stock-notifications/confirm/{token}`
- `GET /wp-json/persi/v1/stock-notifications/unsubscribe/{token}`

## Persistência

Taxonomia: `persi_product_family`.

Metadados:

- termo `persi_family_attributes`: lista ordenada de taxonomias `pa_*`;
- produto `_persi_bought_together`: flag e lista ordenada de IDs/quantidades.

Tabela: `{prefix}_persi_stock_notifications`, criada com `dbDelta`, com índices
para produto, variação, status e unicidade por produto/variação/hash de e-mail.
O e-mail é cifrado com AES-256-GCM e chave derivada dos salts do WordPress; o
hash HMAC separado permite detectar duplicidade sem revelar o endereço.

## Fila, cache e logs

Transições públicas de status de estoque de produto/variação agendam uma ação
única no grupo `persi-headless-stock-notifications`. O lote padrão é 25, possui
lock transitório, até três tentativas e reprocessamento por lote. E-mails não
são enviados dentro do hook de estoque.

Famílias e compre junto usam transient de 60 segundos, com versão, locale e ID
na chave. Salvamento de produto, termo, vínculo e estoque invalida a versão. As
mutações de inscrição nunca usam cache.

Logs permanecem desabilitados por padrão; nenhum e-mail, token ou payload é
registrado.

## CORS

Nenhum cabeçalho CORS global é emitido. O Next.js consulta as rotas GET no
servidor e encaminha inscrições por uma Route Handler da mesma origem, portanto
CORS não é necessário nesta fase. As URLs configuradas definem links do
frontend e deixam preparada a futura validação de origens sem liberar `*`.

## Next.js e fallbacks

Os serviços `persiHeadlessClient`, `productFamilies` e `boughtTogether` possuem
timeout de cinco segundos. A PDP captura falhas: família e compre junto somem,
sem impedir produto ou carrinho. O formulário de estoque mantém a proxy
server-side, envia honeypot e nunca persiste ou registra o e-mail.

## Order bump futuro

O módulo futuro poderá expor somente ofertas públicas e explícitas após a
definição do checkout headless. Não poderá cobrar, alterar pedido, chamar
gateway ou adicionar itens sem ação do cliente. Nesta versão não registra
endpoint nem hook.

## Instalação, teste e rollback

1. Fazer backup e instalar o ZIP apenas em homologação.
2. Ativar manualmente e abrir WooCommerce > Persi Headless.
3. Configurar frontend e módulos.
4. Criar uma família com atributo global e associar produtos.
5. Configurar IDs válidos no metabox Compre junto.
6. Testar inscrição, confirmação, mudança real de estoque, Action Scheduler,
   envio e cancelamento.
7. Validar produto simples, variável, privado, sem atributo, duplicidade,
   honeypot, rate limit, CORS e permissões.

Rollback: desativar o plugin e remover a integração da PDP. A desinstalação
preserva a tabela de inscrições deliberadamente; a exclusão definitiva exige
processo autorizado de retenção/LGPD.
