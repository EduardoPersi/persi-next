import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("migration 36 adds nullable restricted and indexed native session attribution",async()=>{
 const migration=await read("supabase/migrations/20260912050000_admin_session_audit_attribution.sql");
 assert.match(migration,/add column admin_session_id uuid references public\.admin_sessions\(id\) on delete restrict/);
 assert.match(migration,/pim_audit_log_admin_session_idx/);assert.doesNotMatch(migration,/on delete cascade/i);
 assert.match(migration,/NULL denotes legacy or non-admin audit/);
});

test("all protected PIM audit writes carry the trusted AuthorizedAdmin session",async()=>{
 const [actions,workflow]=await Promise.all([read("app/admin/products/[id]/actions.ts"),read("lib/pim/workflow.ts")]);
 assert.match(actions,/adminSessionId:admin\.sessionId/);
 assert.doesNotMatch(actions,/formData\.get\(["']adminSessionId|formData\.get\(["']admin_session_id/);
 assert.equal((workflow.match(/insert into pim_audit_log/g)??[]).length,2);
 assert.equal((workflow.match(/admin_session_id/g)??[]).length,2);
 assert.match(workflow,/adminSessionId:string/);
});

test("PIM mutation and required audit remain in one transaction",async()=>{
 const workflow=await read("lib/pim/workflow.ts");
 assert.match(workflow,/getDatabase\(\)\.transaction/);
 assert.ok(workflow.indexOf("await audit(tx")>workflow.indexOf("update pim_product_profiles"));
 assert.ok(workflow.indexOf("insert into pim_audit_log",workflow.indexOf("decidePimSuggestion"))>workflow.indexOf("update pim_suggestions"));
});
