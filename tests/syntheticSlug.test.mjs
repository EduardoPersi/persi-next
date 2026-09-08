import assert from "node:assert/strict";
import test from "node:test";
import { createSyntheticSlug, SYNTHETIC_SLUG_PATTERN } from "../scripts/database/synthetic-slug.mjs";

test("synthetic slug follows the database products slug contract", () => {
  const cases = [
    ["price-sale_activation", "A1B2C3D4", "price-sale-activation-a1b2c3d4"],
    ["PRICE_SALE_EXPIRY_FIXTURE_READY", "11223344", "price-sale-expiry-fixture-ready-11223344"],
    ["--price__validity  change--", "55667788", "price-validity-change-55667788"],
    ["PRICE_ASSIGNMENT_CHANGE", "99AA00BB", "price-assignment-change-99aa00bb"],
  ];
  for (const [label, suffix, expected] of cases) {
    const slug = createSyntheticSlug(label, suffix);
    assert.equal(slug, expected);
    assert.match(slug, SYNTHETIC_SLUG_PATTERN);
  }
  assert.equal(new Set(cases.map(([label, suffix]) => createSyntheticSlug(label, suffix))).size, cases.length);
});

test("synthetic slug rejects an empty normalized label or suffix", () => {
  assert.throws(() => createSyntheticSlug("___", "abc123"), /SYNTHETIC_SLUG_INPUT_INVALID/);
  assert.throws(() => createSyntheticSlug("valid", "---"), /SYNTHETIC_SLUG_INPUT_INVALID/);
});
