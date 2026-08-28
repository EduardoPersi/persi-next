import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const load=(path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8");

test("PIM P.2 separa draft atual de snapshot aprovado",async()=>{const [migration,workflow]=await Promise.all([load("supabase/migrations/20260827150000_pim_editorial_workflow.sql"),load("lib/pim/workflow.ts")]);assert.match(migration,/approved_content jsonb/);assert.match(workflow,/approved_content=.*::jsonb/s);assert.match(workflow,/profile\.approvedContent/);});
test("workflow cobre create update submit approve reject reopen e discard",async()=>{const workflow=await load("lib/pim/workflow.ts");for(const action of ["CREATE_DRAFT","UPDATE_DRAFT","SUBMIT_REVIEW","APPROVE","REJECT","REOPEN","DISCARD_DRAFT"])assert.match(workflow,new RegExp(action));});
test("concorrência usa lock e rejeita versão stale",async()=>{const workflow=await load("lib/pim/workflow.ts");assert.match(workflow,/for update/);assert.match(workflow,/PIM_STALE_VERSION/);assert.match(workflow,/assertVersion/);});
test("audit trail é escrito dentro da mesma transação",async()=>{const workflow=await load("lib/pim/workflow.ts");assert.match(workflow,/getDatabase\(\)\.transaction/);assert.match(workflow,/insert into pim_audit_log/);assert.doesNotMatch(workflow,/password|DATABASE_URL|cookie/i);});
test("actor vem da sessão administrativa e não do formulário",async()=>{const actions=await load("app/admin/products/[id]/actions.ts");assert.match(actions,/requirePimAdmin/);assert.match(actions,/actor\(user\.id\)/);assert.doesNotMatch(actions,/formData\.get\("actor/);});
test("writes editoriais não alteram source preço estoque ou mappings",async()=>{const workflow=await load("lib/pim/workflow.ts");assert.doesNotMatch(workflow,/update\s+(products|product_variants|prices|inventory_levels|external_mappings)/i);});
test("conteúdo é texto seguro e não aceita HTML arbitrário",async()=>{const [editor,detail]=await Promise.all([load("components/admin/PimEditorialEditor.tsx"),load("app/admin/products/[id]/page.tsx")]);assert.doesNotMatch(editor,/dangerouslySetInnerHTML/);assert.doesNotMatch(detail,/dangerouslySetInnerHTML/);});
test("medidas críticas permanecem literais nos testes reais",async()=>{const sql=await load("supabase/tests/database/pim_editorial_workflow.test.sql");for(const value of ['25mm x 1/2"','16mm x 1/2"','32mm x 3/4"','32 x 25mm','3/4"',"20mm","127V","220V","20A","500W"])assert.ok(sql.includes(value),value);});
test("P.2 não realiza IA externa nem publicação pública",async()=>{const files=await Promise.all(["lib/pim/workflow.ts","app/admin/products/[id]/actions.ts","components/admin/PimEditorialEditor.tsx"].map(load));const joined=files.join("\n");assert.doesNotMatch(joined,/fetch\(|OpenAI|published_at|catalog_search_documents/);});
