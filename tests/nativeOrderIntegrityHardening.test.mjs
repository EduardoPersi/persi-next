import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const migration="supabase/migrations/20260904050000_native_checkout_order_integrity_hardening.sql";
test("store runtime writes are removed and SELECT-only RLS replaces ALL",async()=>{const sql=await readFile(migration,"utf8");assert.match(sql,/revoke insert,update,delete,truncate,references,trigger/);assert.match(sql,/for select to persi_app/);assert.doesNotMatch(sql,/create policy stores_.*for all/i);});
test("reservation link is one-time, owner-scoped and stock-neutral",async()=>{const sql=await readFile(migration,"utf8");assert.match(sql,/order_item_id uuid references public\.order_items\(id\) on delete restrict/);assert.match(sql,/RESERVATION_LINK_CONFLICT/);assert.match(sql,/RESERVATION_ORDER_SCOPE_MISMATCH/);assert.doesNotMatch(sql,/quantity_(on_hand|reserved)\s*=/);});
test("initial pending system event is transaction-deferred and exact",async()=>{const sql=await readFile(migration,"utf8");assert.match(sql,/deferrable initially deferred/);assert.match(sql,/to_status='pending' and actor_type='system'/);assert.match(sql,/ORDER_INITIAL_EVENT_REQUIRED/);});
test("new functions are browser-revoked and fixed-search-path",async()=>{const sql=await readFile(migration,"utf8");assert.match(sql,/security definer set search_path=''/);assert.match(sql,/from public,anon,authenticated/);assert.doesNotMatch(sql,/to anon|to authenticated/);});
