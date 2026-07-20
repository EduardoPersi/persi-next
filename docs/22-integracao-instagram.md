# Integração com o Instagram

## Objetivo

Carregar as publicações recentes da conta oficial da Persi Materiais na Home
usando exclusivamente a API oficial da Meta.

## Pré-requisitos externos

- Conta profissional (Business ou Creator) do Instagram da Persi.
- Página do Facebook vinculada à conta profissional, quando exigida pelo fluxo
  de autenticação escolhido.
- Aplicativo criado no painel Meta for Developers.
- Produto Instagram Graph API configurado no aplicativo.
- Conta da Persi autorizada no aplicativo.
- Permissões aprovadas para leitura do perfil e das mídias da própria conta.
- Instagram User ID e access token válidos.

O aplicativo e as permissões devem ser configurados manualmente no painel da
Meta. O projeto não cria nem autoriza aplicativos automaticamente.

## Variáveis de ambiente

Configurar somente no ambiente do servidor:

```env
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_USER_ID=
```

Nunca utilizar o prefixo `NEXT_PUBLIC_`. O token não deve ser colocado em
componentes, URLs públicas, logs, localStorage ou arquivos versionados.

O arquivo `.env.local` está coberto pela regra `.env*` do `.gitignore`. O
`.env.example` contém apenas os nomes das variáveis, sem credenciais reais.

## Endpoint e dados consultados

O serviço consulta o endpoint Graph:

```text
GET /{instagram-user-id}/media
```

Campos solicitados:

- `id`
- `caption`
- `media_type`
- `media_product_type`
- `media_url`
- `thumbnail_url`
- `permalink`
- `timestamp`

São carregadas no máximo 10 publicações. Métricas, comentários e itens filhos
de álbuns não são solicitados.

## Cache

A resposta da API e as mídias usam revalidação de 1.800 segundos (30 minutos).
Não existe polling no navegador. Após a revalidação, uma nova visita pode
atualizar o cache automaticamente.

As URLs assinadas das mídias permanecem no servidor. A interface usa a rota
local `/api/instagram/media/[id]`, que valida o ID, encontra a mídia na resposta
oficial e entrega somente conteúdo com `Content-Type` de imagem.

## Teste da integração

1. Configure as duas variáveis em `.env.local` ou no provedor de hospedagem.
2. Reinicie o servidor Next.js.
3. Abra a Home e confirme a seção “Siga a gente no Instagram”.
4. Teste imagens, vídeos/Reels, álbuns, links e navegação por teclado.
5. Verifique os logs do servidor em desenvolvimento caso a seção seja omitida.
6. Execute `npm run lint` e `npm run build`.

Sem credenciais, a seção é omitida e a Home continua funcionando.

## Renovação e substituição do token

- Acompanhar a validade do token no painel e nas ferramentas oficiais da Meta.
- Renovar o token antes do vencimento conforme o fluxo de autenticação adotado.
- Substituir `INSTAGRAM_ACCESS_TOKEN` diretamente no ambiente de hospedagem.
- Reiniciar ou redeployar a aplicação após a troca, quando necessário.
- Revogar imediatamente tokens suspeitos ou expostos.
- Nunca registrar o token em tickets, commits, screenshots ou documentação.

As versões e permissões da Graph API evoluem. Antes de renovar a integração,
consultar a documentação oficial da Meta e validar se o endpoint e os campos
continuam disponíveis para o tipo de aplicativo configurado.
