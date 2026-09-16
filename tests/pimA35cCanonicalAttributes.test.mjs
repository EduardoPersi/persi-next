import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const MIGRATION = "supabase/migrations/20260913160000_pim_canonical_attribute_expansion.sql";

test("A3.5C migration never creates diameter or thread as canonical attributes", async () => {
  const migration = await read(MIGRATION);
  assert.doesNotMatch(migration, /'diameter'/);
  assert.doesNotMatch(migration, /'thread'/);
});

test("A3.5C migration creates exactly the four approved attributes with the approved contract", async () => {
  const migration = await read(MIGRATION);
  assert.match(migration, /\('material', 'Material', 'option', 'multiple', null,/);
  assert.match(migration, /\('comprimento', 'Comprimento', 'measurement', 'multiple', 'length',/);
  assert.match(migration, /\('volume', 'Volume', 'measurement', 'multiple', 'volume',/);
  assert.match(migration, /\('conexao', 'Conexão', 'option', 'multiple', null,/);
});

test("A3.5C new attributes start as draft — nothing populates them yet in this phase", async () => {
  const migration = await read(MIGRATION);
  const inserts = migration.match(/\('(?:material|comprimento|volume|conexao)'.*?'draft'\)/gs) ?? [];
  assert.equal(inserts.length, 4);
});

test("A3.5C measurement attributes reuse the project's canonical unit codes, not invented ones", async () => {
  const migration = await read(MIGRATION);
  const seed = await read("supabase/seed.sql");
  // 'mL' (capital L) is the canonical milliliter code already committed in
  // seed.sql — an earlier draft of this migration used lowercase 'ml',
  // which would have created a silent duplicate unit for the same physical
  // concept. This guards against that regression specifically.
  assert.match(migration, /\('mL', 'mL', 'mililitro', 'volume'\)/);
  assert.doesNotMatch(migration, /'ml', 'ml'/);
  assert.match(migration, /\('m', 'm', 'metro', 'length'\)/);
  assert.match(migration, /\('L', 'L', 'litro', 'volume'\)/);
  for (const code of ["m", "mL", "L"]) {
    assert.ok(seed.includes(`'${code}',`), `seed.sql should already define unit code ${code}`);
  }
});

test("A3.5C does not seed any attribute_values for measurement-typed attributes (that is backfill, not schema)", async () => {
  const migration = await read(MIGRATION);
  const volumeSection = migration.slice(migration.indexOf("where a.code = 'conexao'"));
  assert.doesNotMatch(volumeSection, /where a\.code = 'comprimento'|where a\.code = 'volume'/);
});

test("A3.5C migration is idempotent: every insert guards against re-execution with a real constraint", async () => {
  const migration = await read(MIGRATION);
  const inserts = migration.match(/insert into public\.\w+/g) ?? [];
  const onConflicts = migration.match(/on conflict/g) ?? [];
  assert.equal(inserts.length, onConflicts.length, "every insert must have a matching on conflict guard");
  assert.match(migration, /on conflict \(code\) do nothing/);
  assert.match(migration, /on conflict \(attribute_id, option_code\) where option_code is not null do nothing/);
});

test("A3.5C migration never touches operational PIM/catalog tables or bitola/bitola_mm/cor", async () => {
  const migration = await read(MIGRATION);
  // Only real SQL usage counts — the migration's own prose comments mention
  // these table names by design, to explain what it deliberately avoids.
  const sqlOnly = migration.replace(/^--.*$/gm, "");
  assert.doesNotMatch(sqlOnly, /update |delete from |alter table/i);
  assert.doesNotMatch(sqlOnly, /\binto pim_conflicts\b|\binto pim_attribute_reviews\b|\binto pim_attribute_decisions\b|\binto pim_audit_log\b|\binto product_attribute_values\b|\binto products\b|\bfrom products\b/i);
  assert.doesNotMatch(sqlOnly, /'bitola'|'bitola_mm'|'cor'/);
});

test("A3.5C material vocabulary matches real catalog evidence, not an invented ontology", async () => {
  const migration = await read(MIGRATION);
  const materialSection = migration.slice(migration.indexOf("where a.code = 'material'") - 400, migration.indexOf("where a.code = 'material'"));
  for (const value of ["PVC", "CPVC", "Porcelana", "Cobre", "Latão", "Aço Inox", "Aço", "Alumínio", "Polietileno", "Borracha"]) {
    assert.ok(materialSection.includes(`'${value}'`), `expected material value ${value}`);
  }
});

test("A3.5C connection vocabulary is the connection type, never a bitola/size value", async () => {
  const migration = await read(MIGRATION);
  const connectionSection = migration.slice(migration.indexOf("where a.code = 'conexao'") - 300, migration.indexOf("where a.code = 'conexao'"));
  for (const value of ["Soldável", "Roscável", "Compressão", "Engate Rápido", "Flange"]) {
    assert.ok(connectionSection.includes(`'${value}'`), `expected connection value ${value}`);
  }
  assert.doesNotMatch(connectionSection, /\d\s*(mm|cm|m|"|ml|L)\b/);
});
