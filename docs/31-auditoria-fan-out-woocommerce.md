# Auditoria de fan-out do Next.js contra o WooCommerce

## Conclusão

A evidência de 20/08/2026 22:20:19 não é compatível com uma falha exclusiva de checkout. Categorias, produtos da Store API e produtos da REST v3 falharam no mesmo segundo, em 18–76 ms, enquanto o WordPress alternava para erro de conexão com o banco. Isso aponta para indisponibilidade compartilhada do origin (MySQL/PHP/recursos), agravada pelo fan-out do catálogo no Next.js.

Não foi encontrado loop infinito. Foi encontrado fan-out intencional, paralelismo alto em páginas de catálogo e amplificação de HTTP 500 por retry.

## Contagem estática por uma abertura

Os números abaixo representam um cache frio do Next.js e uma página de categorias/marcas com até 100 termos. `A` é a quantidade de atributos globais usados nos filtros. O menu global adiciona duas chamadas Store API quando seu cache está frio (categorias e marcas).

| Rota | Store API de catálogo | REST v3 | Store API privada | Observação |
| --- | ---: | ---: | ---: | --- |
| Home | 8 normalmente; até 10 se a seleção por tag estiver vazia | 2 | 1 no navegador | Menu 2, categorias/marcas 2, novidades 1, destaque 1, ofertas 2; ofertas podem fazer fallback +2. O carrinho hidrata uma vez. |
| Categoria, página 1 | `10 + A` | 2 | 1 no navegador | Menu 2, hierarquia 1, listagem 3, filtros `4 + A`. Cada página adicional solicitada acrescenta até 3 consultas de produtos. |
| Produto simples | 6–10, dependendo da navegação e ofertas | 3–7 no fallback automático | 1 no navegador | Produto, relacionados, marca, categorias, navegação e ofertas; "compre junto" pode consultar REST v3 em cascata. Produto variável adiciona uma Store API. |
| `/checkout` | `N`, uma por produto distinto na validação autoritativa | 0 | 1 server-side | A rota busca o carrinho sem cache, valida os itens, cria a transferência e redireciona. O checkout Woo nativo continua dinâmico. |

As duas chamadas REST v3 frias recorrentes são `products/shipping_classes` e `products?shipping_class=...`. Antes desta auditoria, toda função `getProductsPage` aguardava essa descoberta. Ela já possuía cache de 300 s; agora também é deduplicada dentro de uma única renderização.

## Amplificação confirmada

O cliente Store API considerava HTTP 500 transitório e repetia cada falha uma vez após 150 ms. Assim, uma Home fria com 8–10 chamadas Store podia produzir 16–20 tentativas durante uma falha do banco. HTTP 500 deixou de ser repetido; 429, 502, 503 e 504 mantêm uma única tentativa adicional.

## Cache e isolamento

- Catálogo público continua com revalidação declarada (120 s por padrão; ofertas e frete grátis 300 s).
- Carrinho usa `cache: no-store` e permanece por usuário.
- `/checkout` permanece `force-dynamic`, `revalidate = 0`.
- Sessão, estoque validado, frete, `wc-ajax` e pagamento não receberam cache.

## Correlação na Hostinger

Ativar temporariamente `WOO_REQUEST_DIAGNOSTICS=1` no processo Next.js. Cada chamada passa a registrar `api`, `endpoint`, `status`, `durationMs`, `attempt` e política de cache/revalidação, sem token, credencial ou valores da query.

No intervalo de teste, correlacionar por segundo:

1. quantidade de linhas `[woocommerce-outbound]` no log do Node;
2. acessos a `/wp-json/wc/store/v1/` e `/wp-json/wc/v3/` no access log;
3. `Threads_connected`, `Threads_running`, `Max_used_connections`, `Aborted_connects` e erros `Too many connections`/`MySQL server has gone away`;
4. PHP workers ativos/na fila e limites `pm.max_children` ou equivalentes do provedor;
5. CPU, RAM, swap, I/O wait e latência de disco;
6. `wp-content/debug.log`, log PHP-FPM e error log no mesmo segundo.

Executar uma rota por vez, em janela sem tráfego de teste concorrente, e comparar cache frio com segunda abertura. A segunda abertura deve reduzir fortemente as chamadas de catálogo; a chamada privada de carrinho continuará existindo por projeto.

Se o access log mostrar mais chamadas do que `[woocommerce-outbound]`, a diferença vem de outro consumidor (plugin, cron, crawler, monitor ou integração), não desse processo Next.js.
