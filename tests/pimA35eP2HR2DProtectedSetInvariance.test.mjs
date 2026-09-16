import test from "node:test";
import assert from "node:assert/strict";
import { fingerprintProtectedSet, protectedSetInvariancePass, fingerprintRows } from "../lib/pim/protected-set-invariance.ts";

const P1_14_ROWS = [
  { productId: "03ed7c3b-76e2-436d-92f5-e3f5f46a6d56", attributeCode: "material", value: "PVC" },
  { productId: "03ed7c3b-76e2-436d-92f5-e3f5f46a6d56", attributeCode: "conexao", value: "Soldável" },
  { productId: "03ed7c3b-76e2-436d-92f5-e3f5f46a6d56", attributeCode: "comprimento", value: "75m" },
  { productId: "04575f76-6b2b-4d6b-828e-cf9983046ad5", attributeCode: "conexao", value: "Roscável" },
  { productId: "07faba50-d6c3-48af-9aaf-bb11d3599150", attributeCode: "conexao", value: "Roscável" },
  { productId: "089cbac5-06ce-46cc-bb23-3c00e87d7af5", attributeCode: "conexao", value: "Soldável" },
  { productId: "03256163-a8b9-4695-9fd5-42323918d68c", attributeCode: "material", value: "CPVC" },
  { productId: "018f8856-e94f-4d81-a550-b317309ef1e0", attributeCode: "comprimento", value: "6m" },
  { productId: "089b229c-c172-460f-a54c-c166e6389179", attributeCode: "comprimento", value: "90m" },
  { productId: "03387531-deea-4598-acc0-7b11936adfde", attributeCode: "volume", value: "400ml" },
  { productId: "2acd2cb3-25d4-47f7-8181-ae0c8c18e92b", attributeCode: "volume", value: "18L" },
  { productId: "0177e147-f58d-447e-a4f8-6d94f893b4f1", attributeCode: "material", value: "Aço" },
  { productId: "0265c9cd-c5d0-4cd4-93cb-1f34e4c67b0b", attributeCode: "material", value: "Alumínio" },
  { productId: "16ca220c-b732-4022-a531-96e7b711ba87", attributeCode: "conexao", value: "Compressão" },
];

// ---------- A3.5E-P2-H-R2C root-cause regression: absolute-zero was wrong ----------

test("A3.5E-P2-H-R2D: baseline não-zero (14 linhas P1 legítimas) é aceito quando invariante (CASO A)", () => {
  const before = fingerprintProtectedSet(P1_14_ROWS);
  const after = fingerprintProtectedSet(P1_14_ROWS);
  assert.equal(before.count, 14);
  assert.equal(protectedSetInvariancePass(before, after), true);
});

test("A3.5E-P2-H-R2D CASO B: uma linha P1 adicionada (14->15) é rejeitada", () => {
  const before = fingerprintProtectedSet(P1_14_ROWS);
  const after = fingerprintProtectedSet([...P1_14_ROWS, { productId: "16ca220c-b732-4022-a531-96e7b711ba87", attributeCode: "material", value: "Latão" }]);
  assert.equal(after.count, 15);
  assert.equal(protectedSetInvariancePass(before, after), false);
});

test("A3.5E-P2-H-R2D CASO C: uma linha P1 removida (14->13) é rejeitada", () => {
  const before = fingerprintProtectedSet(P1_14_ROWS);
  const after = fingerprintProtectedSet(P1_14_ROWS.slice(0, 13));
  assert.equal(after.count, 13);
  assert.equal(protectedSetInvariancePass(before, after), false);
});

test("A3.5E-P2-H-R2D CASO D: contagem igual (14=14) mas uma linha alterada é rejeitada", () => {
  const before = fingerprintProtectedSet(P1_14_ROWS);
  const mutated = P1_14_ROWS.map((r, i) => (i === 0 ? { ...r, value: "CPVC" } : r));
  const after = fingerprintProtectedSet(mutated);
  assert.equal(after.count, 14);
  assert.equal(protectedSetInvariancePass(before, after), false);
});

test("A3.5E-P2-H-R2D CASO E: uma linha removida e outra diferente adicionada (mesma contagem, conteúdo diferente) é rejeitada", () => {
  const before = fingerprintProtectedSet(P1_14_ROWS);
  const swapped = [...P1_14_ROWS.slice(1), { productId: "16ca220c-b732-4022-a531-96e7b711ba87", attributeCode: "material", value: "Latão" }];
  const after = fingerprintProtectedSet(swapped);
  assert.equal(after.count, 14);
  assert.equal(protectedSetInvariancePass(before, after), false);
});

test("A3.5E-P2-H-R2D CASO F: mesmas 14 linhas em ordem diferente é aceito (fingerprint independente de ordem)", () => {
  const before = fingerprintProtectedSet(P1_14_ROWS);
  const shuffled = [...P1_14_ROWS].reverse();
  const after = fingerprintProtectedSet(shuffled);
  assert.equal(before.identityHash, after.identityHash);
  assert.equal(protectedSetInvariancePass(before, after), true);
});

// ---------- Propriedades gerais do fingerprint ----------

test("A3.5E-P2-H-R2D: conjunto vazio produz fingerprint determinístico e estável (caso checkpoint sem linhas canônicas)", () => {
  const a = fingerprintProtectedSet([]);
  const b = fingerprintProtectedSet([]);
  assert.equal(a.count, 0);
  assert.equal(a.identityHash, b.identityHash);
  assert.equal(protectedSetInvariancePass(a, b), true);
});

test("A3.5E-P2-H-R2D: campos voláteis (created_at, attribute_value id) não fazem parte do fingerprint", () => {
  const withVolatile = P1_14_ROWS.map((r) => ({ ...r, createdAt: "2020-01-01T00:00:00Z", attributeValueId: "11111111-1111-1111-1111-111111111111" }));
  const withDifferentVolatile = P1_14_ROWS.map((r) => ({ ...r, createdAt: "2099-12-31T23:59:59Z", attributeValueId: "22222222-2222-2222-2222-222222222222" }));
  const a = fingerprintProtectedSet(withVolatile);
  const b = fingerprintProtectedSet(withDifferentVolatile);
  assert.equal(a.identityHash, b.identityHash, "volatile fields must not affect the fingerprint");
});

// ---------- fingerprintRows: workflow tables (reviews/decisions/conflicts) ----------
// R2D negative-test finding: count alone missed a content-only mutation
// (e.g. a review status flip with the row count unchanged). fingerprintRows
// must catch that.

test("A3.5E-P2-H-R2D: fingerprintRows detecta mudança de conteúdo com contagem igual (review status alterado)", () => {
  const before = [{ productId: "p1", attributeId: "a1", status: "approved" }];
  const after = [{ productId: "p1", attributeId: "a1", status: "rejected" }];
  const fBefore = fingerprintRows(before);
  const fAfter = fingerprintRows(after);
  assert.equal(fBefore.count, fAfter.count);
  assert.notEqual(fBefore.identityHash, fAfter.identityHash);
});

test("A3.5E-P2-H-R2D: fingerprintRows aceita conteúdo idêntico em ordem diferente", () => {
  const a = [{ x: "1" }, { x: "2" }];
  const b = [{ x: "2" }, { x: "1" }];
  assert.equal(fingerprintRows(a).identityHash, fingerprintRows(b).identityHash);
});

test("A3.5E-P2-H-R2D: nunca compara contra zero absoluto nem contra literal hardcoded — apenas contra o snapshot BEFORE", () => {
  // Demonstrates the fixed contract directly: protectedSetInvariancePass takes
  // two snapshots (before, after) -- there is no code path that accepts a
  // bare literal count, so a future round cannot regress to the H-R2C
  // "must equal 0" (or "must equal 14") anti-pattern through this API.
  assert.equal(protectedSetInvariancePass.length, 2);
});
