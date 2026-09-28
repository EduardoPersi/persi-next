// A3.7-A-R12: a thin, explicit, fail-closed CLI layer over the ALREADY
// EXISTING publication foundation (lib/pim/publication-service.ts,
// lib/pim/publication-eligibility.ts, lib/pim/publication-runtime-preflight.ts).
// It reimplements NONE of those services' rules -- it only adds the guards
// this round requires BEFORE ever calling them: an explicit, hardcoded,
// non-discoverable manifest (exactly the 5 associations qualified across
// A3.7-A-R6B/R6C/R7/R9/R11), a semantic (project-ref-based, never
// hostname-substring) target check reusing checkDatabaseBinding(), and a
// mandatory, non-empty actor for any state-changing action.
//
// Run via the project's own existing invocation convention (see
// package.json's db:validate:local/db:test scripts):
//   node --conditions=react-server --experimental-loader ./scripts/database/typescript-loader.mjs \
//     scripts/database/pim-publication-canary-executor.mjs --target=staging --action=dry-run
//
// DATABASE_URL is read exactly once, lazily, by lib/db/connection.ts's own
// getDatabase() -- this script never prints it, never constructs a second
// connection, and never accepts a connection string as a CLI argument.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDatabase } from "@/lib/db/connection";
import { preparePublication, publishBatch, unpublishBatch, getPublicationState, computeMemberFingerprint } from "@/lib/pim/publication-service";
import { CURRENT_PIM_BASELINE_SHA256 } from "@/lib/pim/publication-baseline";
import { checkDatabaseBinding } from "@/lib/pim/publication-runtime-preflight";

// ---------------------------------------------------------------------------
// Explicit, hardcoded, closed manifest -- sourced verbatim from
// scratchpad/a37a_r6c_final_canary_manifest_qualification.json (member_fingerprint
// 32a0b3448a289abf2b290e8182606505c9fac31a7d4937f9ae3c6fb51a3b55bf), re-confirmed
// unchanged across R7/R9/R11. Editing this array is a deliberate, reviewable,
// human act -- there is no runtime discovery, no wildcard, no "publish all".
// ---------------------------------------------------------------------------
export const CANARY_MANIFEST = Object.freeze([
  { productId: "1b26a877-7163-40d6-a4f8-bf4d1ae2eb69", attributeId: "edf647e4-8f77-463b-98ca-4efacc78912e", attributeValueId: "947d9996-8043-42ec-8f80-d80dd7b6f9c4", sku: "0117", attributeCode: "comprimento", canonicalValue: "6m" },
  { productId: "1b26a877-7163-40d6-a4f8-bf4d1ae2eb69", attributeId: "31902a11-9084-4811-80c3-e6fc51195d34", attributeValueId: "981a3cf1-9403-46a3-bb52-9d39ce8fc30f", sku: "0117", attributeCode: "conexao", canonicalValue: "Roscável" },
  { productId: "1b26a877-7163-40d6-a4f8-bf4d1ae2eb69", attributeId: "de279916-a725-4f9d-b4cb-310df4396f46", attributeValueId: "d2f00011-cb6c-4e67-8eb0-690e6047d40c", sku: "0117", attributeCode: "material", canonicalValue: "PVC" },
  { productId: "bb466ced-676d-46d6-ade9-c6d2a323d5cc", attributeId: "edf647e4-8f77-463b-98ca-4efacc78912e", attributeValueId: "4102d234-d2e8-4b85-9cec-bd0e4eddd87f", sku: "PVCB5M", attributeCode: "comprimento", canonicalValue: "5m" },
  { productId: "bb466ced-676d-46d6-ade9-c6d2a323d5cc", attributeId: "de279916-a725-4f9d-b4cb-310df4396f46", attributeValueId: "d2f00011-cb6c-4e67-8eb0-690e6047d40c", sku: "PVCB5M", attributeCode: "material", canonicalValue: "PVC" },
]);

export const EXPECTED_FINGERPRINT = "32a0b3448a289abf2b290e8182606505c9fac31a7d4937f9ae3c6fb51a3b55bf";
export const EXPECTED_SKUS = Object.freeze(["0117", "PVCB5M"]);
export const EXPECTED_PRODUCT_COUNT = 2;
export const EXPECTED_ASSOCIATION_COUNT = 5;
export const REQUIRED_TARGET = "staging";

const toIdentity = (m) => ({ productId: m.productId, attributeId: m.attributeId, attributeValueId: m.attributeValueId });

/** Pure. No I/O. Validates the manifest's shape against the frozen
 * expectations above -- defends against a future accidental edit to
 * CANARY_MANIFEST, not against external input (there is none). */
export function validateManifestGuards(manifest = CANARY_MANIFEST) {
  const errors = [];
  if (manifest.length !== EXPECTED_ASSOCIATION_COUNT) errors.push(`ASSOCIATION_COUNT_MISMATCH:expected=${EXPECTED_ASSOCIATION_COUNT}:actual=${manifest.length}`);
  const skus = [...new Set(manifest.map((m) => m.sku))].sort();
  const expectedSkusSorted = [...EXPECTED_SKUS].sort();
  if (JSON.stringify(skus) !== JSON.stringify(expectedSkusSorted)) errors.push(`SKU_MISMATCH:expected=${expectedSkusSorted.join(",")}:actual=${skus.join(",")}`);
  if (skus.length !== EXPECTED_PRODUCT_COUNT) errors.push(`PRODUCT_COUNT_MISMATCH:expected=${EXPECTED_PRODUCT_COUNT}:actual=${skus.length}`);
  const fingerprint = computeMemberFingerprint(manifest.map(toIdentity));
  if (fingerprint !== EXPECTED_FINGERPRINT) errors.push(`FINGERPRINT_MISMATCH:expected=${EXPECTED_FINGERPRINT}:actual=${fingerprint}`);
  return { ok: errors.length === 0, errors, fingerprint };
}

/** Pure over its input (reads env var value only to hand to the already-
 * existing, already-safe-to-log checkDatabaseBinding() -- never returns or
 * prints the raw value). Rejects anything other than the single literal
 * string "staging": production, missing, typo'd, or any other target all
 * fail the same way, by construction. */
export function validateTargetBinding(databaseUrl, target) {
  if (target !== REQUIRED_TARGET) return { ok: false, reason: `TARGET_INVALID:${target ?? "MISSING"}` };
  const binding = checkDatabaseBinding(databaseUrl);
  if (!binding.present) return { ok: false, reason: "DATABASE_URL_MISSING" };
  if (!binding.matchesExpectedStaging) return { ok: false, reason: `PROJECT_REF_MISMATCH:${binding.projectRef ?? "UNKNOWN"}` };
  return { ok: true, projectRef: binding.projectRef };
}

/** Mirrors publication-service.ts's own requireActor() constraint, restated
 * at the CLI boundary for an earlier, clearer failure -- not a second,
 * different rule. */
export function validateActor(actor) {
  const trimmed = (actor ?? "").trim();
  if (!trimmed) return { ok: false, reason: "ACTOR_REQUIRED" };
  if (trimmed.length > 200) return { ok: false, reason: "ACTOR_TOO_LONG" };
  return { ok: true, actor: trimmed };
}

/** Read-only. Reuses the EXACT row shape publishBatch() itself locks and
 * branches on (lib/pim/publication-service.ts lines 188-195) so the
 * operator sees the same ownership signal BEFORE attempting a write that
 * would otherwise throw PimPublicationOwnedByAnotherBatchError. */
async function checkOwnership(manifest) {
  const db = getDatabase();
  const rows = [];
  for (const identity of manifest) {
    const existing = await db.execute(sql`
      select state::text as state, batch_id::text as "batchId" from public.pim_attribute_publications
      where product_id=${identity.productId}::uuid and attribute_id=${identity.attributeId}::uuid and attribute_value_id=${identity.attributeValueId}::uuid
    `);
    rows.push({ sku: identity.sku, attributeCode: identity.attributeCode, currentState: existing[0]?.state ?? null, ownedByBatch: existing[0]?.batchId ?? null });
  }
  return rows;
}

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(raw);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function fail(message) {
  console.error(`PIM_PUBLICATION_EXECUTOR_FAIL: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target;
  const action = args.action;

  const manifestCheck = validateManifestGuards(CANARY_MANIFEST);
  if (!manifestCheck.ok) return fail(`MANIFEST_GUARD:${manifestCheck.errors.join("|")}`);

  const bindingCheck = validateTargetBinding(process.env.DATABASE_URL, target);
  if (!bindingCheck.ok) return fail(`TARGET_GUARD:${bindingCheck.reason}`);

  console.log(JSON.stringify({ manifestFingerprint: manifestCheck.fingerprint, targetProjectRef: bindingCheck.projectRef, action }, null, 2));

  if (action === "dry-run" || action === "prepare") {
    const eligibility = await preparePublication(CANARY_MANIFEST.map(toIdentity), CURRENT_PIM_BASELINE_SHA256);
    const ownership = await checkOwnership(CANARY_MANIFEST);
    const report = CANARY_MANIFEST.map((m, i) => ({ sku: m.sku, attribute: m.attributeCode, canonicalValue: m.canonicalValue, eligible: eligibility[i].eligible, reasonCodes: eligibility[i].reasonCodes, currentState: ownership[i].currentState, ownedByBatch: ownership[i].ownedByBatch }));
    console.log(JSON.stringify({ report }, null, 2));
    const ineligible = report.filter((r) => !r.eligible);
    if (ineligible.length > 0) return fail(`NOT_ELIGIBLE:${ineligible.map((r) => `${r.sku}/${r.attribute}:${r.reasonCodes.join("+")}`).join(",")}`);
    const owned = report.filter((r) => r.currentState === "published");
    if (owned.length > 0) return fail(`ALREADY_PUBLISHED_ELSEWHERE:${owned.map((r) => `${r.sku}/${r.attribute}:batch=${r.ownedByBatch}`).join(",")}`);
    if (action === "prepare") {
      const batchId = randomUUID();
      console.log(JSON.stringify({ preparedBatchId: batchId, note: "Use exactly this --batch-id for the subsequent publish action. Not written anywhere yet." }, null, 2));
    }
    return;
  }

  if (action === "publish") {
    const actorCheck = validateActor(args.actor);
    if (!actorCheck.ok) return fail(`ACTOR_GUARD:${actorCheck.reason}`);
    if (!args["batch-id"]) return fail("BATCH_ID_REQUIRED");
    const result = await publishBatch({ batchId: args["batch-id"], kind: "canary", members: CANARY_MANIFEST.map(toIdentity), baselineReference: CURRENT_PIM_BASELINE_SHA256, reason: args.reason ?? "A3.7-A canary" }, actorCheck.actor);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (action === "reconcile") {
    if (!args["batch-id"]) return fail("BATCH_ID_REQUIRED");
    const state = await getPublicationState(args["batch-id"]);
    if (!state) return fail("BATCH_NOT_FOUND");
    const expectState = args["expect-state"] ?? "published";
    const members = state.members;
    const wrongState = members.filter((m) => m.state !== expectState);
    const ok = members.length === EXPECTED_ASSOCIATION_COUNT && wrongState.length === 0;
    console.log(JSON.stringify({ batch: state.batch, memberCount: members.length, expectedCount: EXPECTED_ASSOCIATION_COUNT, expectState, wrongState, reconciled: ok, members }, null, 2));
    if (!ok) return fail(`RECONCILE_MISMATCH:count=${members.length}/${EXPECTED_ASSOCIATION_COUNT}:wrongState=${wrongState.length}`);
    return;
  }

  if (action === "rollback") {
    const actorCheck = validateActor(args.actor);
    if (!actorCheck.ok) return fail(`ACTOR_GUARD:${actorCheck.reason}`);
    if (!args["batch-id"]) return fail("BATCH_ID_REQUIRED");
    const result = await unpublishBatch(args["batch-id"], actorCheck.actor, args.reason ?? "A3.7-A canary rollback");
    console.log(JSON.stringify(result, null, 2));
    if (result.unpublishedCount !== EXPECTED_ASSOCIATION_COUNT && !result.idempotentReplay) return fail(`ROLLBACK_COUNT_MISMATCH:expected=${EXPECTED_ASSOCIATION_COUNT}:actual=${result.unpublishedCount}`);
    return;
  }

  return fail(`ACTION_INVALID:${action ?? "MISSING"} (expected dry-run|prepare|publish|reconcile|rollback)`);
}

// Only run the CLI when invoked directly (not when imported for tests).
if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  await main();
}
