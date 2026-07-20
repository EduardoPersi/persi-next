# 20 — Segurança

## Objetivo

Garantir a segurança do front-end e das integrações.

## Boas práticas

- HTTPS obrigatório
- Nunca expor chaves privadas
- Utilizar variáveis de ambiente
- Validar todas as entradas

## APIs

- Tratar erros
- Validar respostas
- Definir timeouts
- Não confiar em dados do cliente

## Autenticação

- Sessões seguras
- Tokens protegidos
- Logout correto
- Rotas privadas protegidas

## Dependências

- Manter bibliotecas atualizadas
- Remover dependências sem uso
- Corrigir vulnerabilidades

## Cabeçalhos

Recomenda-se utilizar:

- Content-Security-Policy
- X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy

## Checklist

- Sem secrets no Git
- HTTPS ativo
- Ambiente separado (dev/homologação/produção)
- Logs revisados
