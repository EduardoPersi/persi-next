# Favoritos

Visitantes mantêm somente IDs de produtos no `localStorage`, na chave
`persi_favorite_products`. Clientes autenticados persistem favoritos na tabela
`{prefix}persi_favorites`, criada pelo plugin `persi-headless-account`.

Após autenticação, o `FavoritesProvider` lê os favoritos do servidor, une-os aos
IDs locais, elimina duplicatas, envia a união para `PUT /favorites/sync` e só
então limpa a chave local. Falhas mantêm os IDs locais para uma nova tentativa.

As rotas WordPress usam o namespace `persi-headless/v1` e exigem a mesma
assinatura HMAC e sessão opaca da área de cliente. O navegador acessa apenas os
Route Handlers do Next.js; credenciais privadas não são expostas.

A página pública funcional é `/favoritos`, mas usa `noindex, nofollow`. A
arquitetura mantém os IDs separados da apresentação, permitindo futuramente
adicionar listas compartilháveis como `/favoritos/{codigo}` sem alterar a lista
pessoal atual.
