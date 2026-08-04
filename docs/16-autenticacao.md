# 16 — Autenticação

A arquitetura oficial de autenticação está documentada em
[`docs/authentication.md`](./authentication.md).

O JWT emitido pelo WordPress é a única fonte de verdade. Não existem NextAuth,
sessão opaca, autenticação HMAC de conta ou cookies paralelos.
