import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath=new URL("../supabase/migrations/20260827120000_pim_v1_foundation.sql",import.meta.url);
const repositoryPath=new URL("../lib/pim/repository.ts",import.meta.url);
const authPath=new URL("../lib/pim/authorization.ts",import.meta.url);
const providerPath=new URL("../lib/pim/enrichment-provider.ts",import.meta.url);
const workflowPath=new URL("../lib/pim/workflow.ts",import.meta.url);

test("PIM mantém suggestions de IA sob revisão humana",async()=>{const sql=await readFile(migrationPath,"utf8");assert.match(sql,/source <> 'ai' or status <> 'approved' or reviewed_by is not null/);assert.match(sql,/default 'needs_review'/);});
test("PIM suporta aprovação, rejeição, provenance e audit trail",async()=>{const [sql,workflow]=await Promise.all([readFile(migrationPath,"utf8"),readFile(workflowPath,"utf8")]);assert.match(sql,/pim_decision_status as enum \('needs_review','approved','rejected'\)/);assert.match(sql,/create table public\.pim_audit_log/);assert.match(workflow,/for update/);assert.match(workflow,/insert into pim_audit_log/);});
test("admin é server-only, autorizado e paginado",async()=>{const [repo,auth]=await Promise.all([readFile(repositoryPath,"utf8"),readFile(authPath,"utf8")]);assert.match(repo,/import "server-only"/);assert.match(repo,/limit \$\{pageSize\} offset/);assert.match(auth,/getAuthenticatedSession/);assert.match(auth,/manage_woocommerce/);});
test("contrato de IA existe sem chamada externa",async()=>{const provider=await readFile(providerPath,"utf8");assert.match(provider,/interface PimEnrichmentProvider/);assert.doesNotMatch(provider,/fetch\(|OpenAI|axios/);});
test("casos críticos de medida e unidade permanecem cobertos pelo PIM existente",async()=>{const docs=await readFile(new URL("../docs/database/05-pim.md",import.meta.url),"utf8");for(const value of ['25mm x 1/2"','16mm x 1/2"','32mm x 3/4"','32 x 25mm'])assert.match(docs,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));for(const value of ["mm","cm","m","in","W","kW","V","A","HP","CV"])assert.match(docs,new RegExp(`\\b${value}\\b`));});
test("schema operacional preserva SKU e GTIN e migration PIM não altera preço ou estoque",async()=>{const [catalog,migration]=await Promise.all([readFile(new URL("../lib/db/schema/catalog.ts",import.meta.url),"utf8"),readFile(migrationPath,"utf8")]);assert.match(catalog,/sku: text\(\)\.notNull/);assert.match(catalog,/gtin: text\(\)/);assert.doesNotMatch(migration,/update\s+(prices|inventory_levels|product_variants)/i);});
