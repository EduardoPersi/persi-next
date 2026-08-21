# Auditoria de estabilidade do checkout

## Baselines identificadas

- `persi-headless` 0.4.0: commit `1d19fd90ad5d7d40373ab33253cd0f0481e98edb`.
- `persi-headless-checkout` 0.4.0: commit `e48d2dd9568a3cd5a57f43d8e59073479057ea89`.
- Estado auditado: `39de28638523dcb73d5331af00fc6147700da1ff`.

O primeiro plugin controla APIs de catálogo e o storefront lockdown. O segundo
controla tabela, token, sessão, carrinho e redirects do checkout. A investigação
precisa considerar ambos; restaurar apenas o ZIP `persi-headless` 0.4.0 não
restauraria o fluxo de transferência.

## Classificação das mudanças posteriores

| Alteração | Versão/commit | Objetivo | Risco checkout | Risco banco | Decisão |
| --- | --- | --- | --- | --- | --- |
| Checkout nativo direto e endereços opcionais | checkout 0.5.0–0.5.1 (`3fb41d0`, `6df9a9a`) | Permitir saída direta do carrinho | Médio | Baixo | Manter |
| Cupons e snapshot de cupons | checkout 0.5.2 (`3454614`) | Preservar regra comercial | Baixo | Baixo | Manter |
| Compatibilidade Smart Checkout | checkout 0.5.3–0.5.4 (`1d58db5`, `964c9b3`) | Liberar script no backend | Médio; possível loading se o script fornecedor mudar | Nenhum | Manter isolado e monitorar |
| Cliente autenticado | checkout 0.5.5 (`9ce0e13`) | Preservar login | Médio | Baixo | Manter |
| Reverse proxy público | checkout 0.5.6 (`7e1d7c4`) | Checkout no domínio público | Alto fora do plugin | Nenhum direto | Manter; não alterado |
| Store API de frete grátis | headless 0.5.0 (`14ba481`) | Expor flag de produto | Baixo | Baixo | Já revertido em 0.5.2 |
| Upgrade ligado à versão funcional | headless até 0.5.2 | Atualizar tabelas | Médio | Alto sob concorrência | Refatorado em 0.5.3 |
| Lockdown baseado em condições implícitas | headless 0.4.0 | Fechar vitrine WP | Alto para rotas técnicas | Nenhum | Endurecido em 0.5.3 |

Não foram encontradas mudanças de GTIN, marca, vídeo ou SEO dentro do delta
0.4.0–0.5.2 do plugin principal. Os módulos atuais de família, compre junto,
notificações, newsletter e contato foram preservados.

## Banco de dados

O plugin principal comparava `persi_headless_db_version` com a versão funcional.
Cada bump podia disparar dois `dbDelta`, `SHOW INDEX`, `ALTER/UPDATE` de migração
durante uma request pública. Antes que uma request concluísse o `update_option`,
outras requests concorrentes podiam repetir o trabalho. A 0.5.3 desacopla a
versão do esquema e executa upgrade somente em `admin_init`, protegido por lock
atômico via `add_option` não autoload.

O plugin de checkout consulta a tabela de transferências somente ao criar ou
consumir token. Após o redirect 303 sem parâmetro, checkout e `wc-ajax` usam a
sessão WooCommerce normal e não consultam novamente a transferência.

O erro “Erro ao estabelecer uma conexão com o banco de dados” não pode ser
atribuído conclusivamente ao plugin sem `Too many connections`, slow log, log
MySQL/MariaDB, PHP e métricas Hostinger. A migração concorrente era um vetor
real removido; limites de CPU, RAM, I/O, PHP workers e `max_connections` ainda
precisam ser correlacionados por timestamp.

## Sessão, redirects e AJAX

- O token usa hash, aquisição atômica `pending -> processing`, finalização
  `processing -> used` e rejeita reutilização.
- O carrinho chama `wc_load_cart()` somente se sessão, cliente ou carrinho ainda
  não existirem.
- Após restaurar itens, cupons, cliente e owner token, persiste carrinho/cookie e
  responde 303 para checkout sem token.
- O lockdown agora libera explicitamente REST, `wc-ajax`, `wc-api` e
  `wp-admin/admin-ajax.php`, além das proteções nativas já existentes.
- O Worker não foi alterado. Seu teste deve confirmar POST 200 JSON sem Location.

## Diagnóstico temporário

Para habilitar em homologação:

```php
define( 'PERSI_HEADLESS_CHECKOUT_DIAGNOSTICS', true );
```

O log WooCommerce registra apenas path sem query, tipo, ação `wc-ajax`
sanitizada, tempo, pico de memória, contagem aproximada de queries e flags de
sessão/carrinho. Não registra token, query string, cookies, autorização ou dados
pessoais. Remova a constante após a coleta.

## Validação remota pendente

Sem acesso ao WordPress/Hostinger/MySQL, permanecem pendentes em staging:

1. 30 transferências e carregamentos sequenciais, sem concorrência agressiva.
2. `update_order_review` e `get_refreshed_fragments`: HTTP 200, JSON e sem Location.
3. CEP/frete, Pix, boleto, cartão e pedido de teste até `order-received`.
4. Comparar logs de aplicação com conexões, slow queries, CPU, RAM, I/O e PHP workers.

## Artefatos

- `persi-headless.zip` 0.5.3 — SHA-256 `3A07A1F64E329EF4F15A640A1AC127330E0BF270C50D5FBEE418C215FB707E12`.
- `persi-headless-checkout.zip` 0.5.7 — SHA-256 `1CB7540DB2364CF31A8FDC25E304994171B1DA89CEF7265EDA23EBB01C152AF1`.

Os dois arquivos são gerados com separadores POSIX (`/`). Não usar
`Compress-Archive` no Windows para estes pacotes, pois ele grava `\` nos nomes
internos e impede a extração correta em hospedagens Linux.
