# F.4.1 — Hostinger runtime audit via SSH

Auditoria read-only concluída anteriormente: runtime Hostinger-managed, Node 22.18.0, três processos Next, sem cron/supervisor adicional acessível e persistência local provavelmente efêmera. `DATABASE_URL` e `DIRECT_URL` estavam ausentes; DNS/TCP para Supabase passaram. Modelo C selecionado: endpoint interno curto, autenticado e idempotente, acionado por scheduler externo confiável.

Na F.4.2 de 2026-08-26, Hostinger não foi alterada. A etapa parou antes dos gates de runtime e deploy porque a paridade comercial falhou.
