# 16 — Autenticação

## Objetivo

Oferecer login simples e seguro.

## Métodos

- E-mail e senha
- Google
- Facebook (futuro)

## Login com Google

O Google usa OAuth 2.0/OpenID Connect com Authorization Code Flow totalmente
server-side. O navegador inicia em `/api/auth/google/start`; o callback chega em
`/api/auth/google/callback`. O Next.js valida `state`, nonce, PKCE, assinatura
RS256, issuer, audience, expiração e `email_verified` antes de enviar ao
WordPress somente a identidade validada, protegida pelo HMAC Account.

Variáveis privadas obrigatórias:

```text
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=https://yellowgreen-ram-345959.hostingersite.com/api/auth/google/callback
```

Nenhuma delas deve usar `NEXT_PUBLIC_`.

No cliente OAuth Web do Google Cloud, cadastrar exatamente:

- homologação:
  `https://yellowgreen-ram-345959.hostingersite.com/api/auth/google/callback`;
- produção futura:
  `https://persimateriais.com.br/api/auth/google/callback`.

Não adicionar barra final. O callback definitivo só pode ser habilitado quando
`persimateriais.com.br` estiver servindo ou encaminhando essa rota ao Next.js.
Como o botão usa redirect server-side e não uma biblioteca JavaScript, origens
JavaScript não são necessárias. Se uma configuração futura exigir origens,
limitar a:

- `https://yellowgreen-ram-345959.hostingersite.com`;
- `https://persimateriais.com.br`.

São solicitados somente `openid`, `email` e `profile`, sem acesso offline. Tokens
Google não são persistidos nem enviados ao WordPress ou navegador. O plugin
armazena HMAC-SHA256 determinístico do `sub` e do e-mail verificado na tabela
`{prefix}persi_account_identities`, com unicidade por provedor/subject e
provedor/e-mail. A sessão do cliente continua sendo a sessão opaca Persi.

## Funcionalidades

- cadastro
- login
- logout
- recuperação de senha
- alteração de senha
- perfil

## Sessão

- armazenar token com segurança
- renovar sessão quando necessário
- encerrar sessão ao expirar

## Perfil

Usuário pode visualizar:
- pedidos
- endereços
- dados pessoais

## Segurança

- HTTPS obrigatório
- nunca expor tokens
- validar permissões
- proteger rotas privadas

## Experiência

- login rápido
- mensagens amigáveis
- redirecionamento após autenticação

## Checklist

- login funcionando
- logout funcionando
- recuperação validada
- sessões protegidas
