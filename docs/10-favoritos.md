# Favoritos

Favoritos é uma implementação do módulo genérico Customer Lists. Visitantes
mantêm somente IDs no `localStorage`, na chave `customer_lists`, no formato
`{ "favorites": [1, 2] }`. A leitura migra automaticamente a antiga chave
`persi_favorite_products`.

Clientes autenticados persistem listas na tabela
`{prefix}persi_customer_lists`. Após autenticação, o `CustomerListsProvider`
percorre os tipos registrados, une os itens do servidor aos IDs locais, elimina
duplicatas, envia a união para `PUT /customer-lists/{listType}/sync` e só então
limpa o storage. Falhas preservam os IDs locais para nova tentativa.

As rotas WordPress usam o namespace `persi-headless/v1` e exigem a mesma
assinatura HMAC e sessão opaca da área de cliente. O navegador acessa apenas os
Route Handlers do Next.js; credenciais privadas não são expostas.

A página funcional permanece `/favoritos`, com `noindex, nofollow`, e a área
autenticada `/minha-conta/listas` exibe apenas Favoritos. Para adicionar um tipo,
registre-o em `CUSTOMER_LIST_TYPES` no Next.js e em `LIST_TYPES` no serviço PHP;
não é necessário criar outro repository, context ou service.
