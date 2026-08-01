# Customer Workspace

## Objetivo

Centralizar todos os recursos privados do cliente em `/minha-conta`, com sessão
HttpOnly, respostas sem cache e páginas `noindex, nofollow`.

## Estrutura

- `lib/customer-workspace`: tipos e registro de navegação;
- `components/Account/CustomerWorkspaceShell`: sidebar desktop e drawer mobile;
- `services/account/workspace`: comunicação HMAC com o plugin;
- `app/api/account/workspace`: proxy same-origin sem exposição da sessão;
- `wordpress-plugin/persi-headless-account/src/CustomerWorkspace`: dados reais
  do WooCommerce, identidades e inscrições de estoque.

## Recursos atuais

- resumo com pedidos, favoritos, listas e endereços;
- pedidos e detalhes;
- endereços de cobrança e entrega, com seleção de principal;
- perfil, telefone, nascimento, CPF e alteração de senha;
- Favoritos por Customer Lists;
- lista de espera integrada à tabela de notificações;
- produtos vistos no dispositivo;
- identidades Google e Facebook conectadas;
- central de notificações preparada para novos canais.

## Evolução

Novos recursos devem registrar um item em `CUSTOMER_WORKSPACE_NAVIGATION`, criar
uma página protegida com `CustomerWorkspacePage` e centralizar integrações em
`services/account/workspace`. Endereços adicionais exigirão armazenamento
próprio, pois o WooCommerce oferece nativamente os slots billing e shipping.
