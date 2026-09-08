# PIM test artifacts

## Purpose

The normal test suite must be reproducible from a clean clone with installed
dependencies. It must not depend on ignored files, historical OpenAI responses,
staging state, credentials, or prior local runs.

## Normal contract fixtures

Versioned fixtures live in `tests/fixtures/pim-artifacts`. Their `manifest.json`
records the contract, origin, and sanitization boundary. Every fixture is explicitly
classified as synthetic and proves only deterministic code invariants; it is not
evidence that staging, persistence, or an AI request ran successfully.

Run the normal PIM contracts with:

```bash
npm run test:pim
```

`scripts/test-normal.mjs` is also the discovery entry point for `npm test`. It reads
the evidence manifest, excludes historical evidence tests, and fails before running
if any included test references `supabase/.temp/pim-ai`.

## Historical evidence

`tests/evidence/pim/manifest.json` is the authoritative inventory of tests that
describe prior controlled executions. The evidence itself remains private and
ignored under `supabase/.temp/pim-ai`; it must never be copied into Git merely to
make the normal suite pass.

After restoring a previously preserved evidence package, validate it offline with:

```bash
npm run test:pim:evidence
```

This command does not contact staging, production, or OpenAI, and it never downloads
or regenerates missing evidence. Absence of the package is an explicit failure, not
a silent skip.

## Adding or changing tests

- Put stable logic and schema assertions in normal tests backed by minimal synthetic
  fixtures.
- Put claims about real counts, costs, markers, writes, model responses, or staging
  observations in the evidence suite.
- Never make a historical assertion optional with `if (!existsSync(...)) return`.
- Keep secrets, tokens, personal data, commercial identifiers, raw prompts, raw model
  responses, and machine-specific paths out of committed fixtures.
- Update the appropriate manifest whenever the classification changes.
