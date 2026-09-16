import crypto from "node:crypto";

// A3.5E-P2-H-R2D: root cause of the H-R2C rollback was a false-positive
// pre-commit gate that demanded `count(P1/checkpoint rows) === 0` inside the
// write transaction -- but persi-staging legitimately already had 14 P1
// pilot-backfill rows (and checkpoint "cor" rows) BEFORE the transaction
// ever began, from an earlier, already-authorized round. An absolute-zero
// assertion is the wrong invariant for any table that already holds
// legitimate protected data; the correct invariant is that the protected
// set must be UNCHANGED by this transaction -- same count AND same content
// -- never that it must be empty, and never a hardcoded literal like `14`
// (which would just be a different, equally fragile constant that breaks
// the moment a future, separately-authorized round legitimately grows P1).
//
// Only stable, semantic fields go into the fingerprint (product_id,
// attribute_code, the value's own display text) -- never volatile columns
// such as created_at or the attribute_value row's own uuid, which can
// legitimately differ across environments/inserts without the observable
// content having changed, and would otherwise manufacture false drift.

export type ProtectedRow = { productId: string; attributeCode: string; value: string };

export type ProtectedSetSnapshot = { count: number; identityHash: string };

export function fingerprintProtectedSet(rows: ProtectedRow[]): ProtectedSetSnapshot {
  const canonical = rows
    .map((r) => ({ productId: r.productId, attributeCode: r.attributeCode, value: r.value }))
    .sort((a, b) => {
      const ka = `${a.productId}:${a.attributeCode}:${a.value}`;
      const kb = `${b.productId}:${b.attributeCode}:${b.value}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  const identityHash = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { count: canonical.length, identityHash };
}

// A3.5E-P2-H-R2D negative-test finding: checking pim_attribute_reviews /
// pim_attribute_decisions / pim_conflicts by COUNT alone is not enough --
// a status flip (e.g. a review silently changed from 'approved' to
// 'rejected', or a conflict silently 'resolved') leaves the row count
// unchanged, so a count-only gate reports false PASS. These workflow
// tables need the same count+content invariance discipline as the P1/
// checkpoint protected set, just with their own semantic row shape. This
// generic helper fingerprints any flat, string-valued row shape the same
// way (stable field order, sorted, content-only) so each protected table
// can define its own semantically-relevant fields without duplicating the
// canonicalization logic.
export function fingerprintRows<T extends Record<string, string>>(rows: T[]): ProtectedSetSnapshot {
  const canonical = rows
    .map((r) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]])))
    .sort((a, b) => {
      const ka = JSON.stringify(a);
      const kb = JSON.stringify(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  const identityHash = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { count: canonical.length, identityHash };
}

// Invariance means: exactly the same rows, in count and in content, appear
// after the transaction as appeared before it. NOT "equals zero", NOT
// "equals some hardcoded number" -- equals whatever BEFORE legitimately was.
export function protectedSetInvariancePass(before: ProtectedSetSnapshot, after: ProtectedSetSnapshot): boolean {
  return before.count === after.count && before.identityHash === after.identityHash;
}
