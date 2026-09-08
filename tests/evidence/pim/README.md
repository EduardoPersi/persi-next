# PIM historical evidence tests

These tests validate immutable facts about past controlled executions. They are not
part of `npm test` and must not be converted into claims about a new execution.

Run `npm run test:pim:evidence` only after restoring the private, ignored
`supabase/.temp/pim-ai` evidence package. The command is offline, never downloads or
regenerates evidence, and fails explicitly when the package is absent.
