import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("admin separa current/suggested, mostra evidence e mantém ações server-side",()=>{const panel=readFileSync("components/admin/PimEnrichmentPanel.tsx","utf8"),page=readFileSync("app/admin/products/[id]/page.tsx","utf8"),actions=readFileSync("app/admin/products/[id]/actions.ts","utf8");assert.match(panel,/>Current</);assert.match(panel,/>Suggested</);assert.match(panel,/e\.rawValue\?\?e\.value/);assert.match(panel,/Source fingerprint/);assert.match(page,/action=\{reviewSuggestion\}/);assert.match(page,/value="approved"/);assert.match(page,/value="rejected"/);assert.match(actions,/"use server"/);assert.match(actions,/requirePimAdmin/);});
