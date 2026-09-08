import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const path = "supabase/migrations/20260905180000_native_checkout_atomic_submission.sql";
const sql = readFileSync(path, "utf8");
const lower = sql.toLowerCase();

test("M29 candidate adds the nullable immutable request hash", () => {
  assert.match(lower, /alter table public\.orders add column submission_request_hash text;/);
  assert.ok(lower.includes("submission_request_hash is null or submission_request_hash~'^[0-9a-f]{64}$'"));
  assert.match(lower, /new\.submission_request_hash is distinct from old\.submission_request_hash/);
});

test("cart authority is definer-only, owner-aware, and select-only", () => {
  for (const name of ["create_native_cart", "add_native_cart_item", "set_native_cart_item_quantity", "remove_native_cart_item", "merge_native_carts"]) {
    const start = lower.indexOf(`create function public.${name}(`);
    assert.notEqual(start, -1, name);
    const body = lower.slice(start, lower.indexOf("end $$;", start) + 7);
    assert.match(body, /security definer set search_path=''/);
    assert.match(body, /p_customer_id/);
  }
  assert.match(lower, /revoke insert,update,delete,truncate,references,trigger on public\.carts,public\.cart_items from persi_app,persi_worker/);
  assert.doesNotMatch(lower, /create policy carts_app on public\.carts for all/);
  assert.doesNotMatch(lower, /grant (select,)?insert/);
});

test("create cart follows the real store default-currency contract", () => {
  const start = lower.indexOf("create function public.create_native_cart(");
  const body = lower.slice(start, lower.indexOf("end $$;", start) + 7);
  assert.match(body, /s\.default_currency=p_currency/);
  assert.doesNotMatch(body, /s\.currency=p_currency/);
});

test("structural cart guards serialize items and constrain transitions", () => {
  assert.match(lower, /create trigger cart_items_mutability_guard before insert or update or delete/);
  assert.match(lower, /from public\.carts where id=v_cart_id for update/);
  assert.match(lower, /old\.status='locked' and new\.status in \('active','converted'\)/);
  assert.match(lower, /message='cart_version_conflict'/);
  assert.match(lower, /cart_item_reparent_forbidden/);
  assert.doesNotMatch(lower, /create function public\.(unlock|convert)_native_cart/);
});

test("submission is locked, idempotent, canonical, and immutable-snapshot based", () => {
  const start = lower.indexOf("create function public.submit_native_checkout(");
  const body = lower.slice(start, lower.indexOf("end $$;", start) + 7);
  assert.match(body, /security definer set search_path=''/);
  assert.match(body, /checkout_sessions where id=p_checkout_id for update/);
  assert.match(body, /carts where id=s\.cart_id for update/);
  assert.match(body, /c\.version<>s\.cart_version\+1/);
  assert.match(body, /canonical_native_submission_request_hash\(s\.id,s\.version\)/);
  assert.match(body, /resolve_store_price_authority\(s\.store_id,s\.currency,'storefront_retail',v_now\)/);
  assert.doesNotMatch(body, /resolve_store_price_authority\(s\.store_id,s\.currency,'checkout'/);
  assert.match(body, /p\.list_amount_minor<>i\.unit_regular_amount_minor/);
  assert.doesNotMatch(body, /p\.regular_amount_minor/);
  assert.match(body, /existing\.submission_request_hash<>p_submission_request_hash/);
  assert.match(body, /line\.sku_snapshot,null,line\.product_name_snapshot/);
  assert.doesNotMatch(body, /product_variants/);
  assert.match(body, /'pending'/);
  assert.match(body, /'native_checkout_submitted'/);
  assert.match(body, /set constraints public\.orders_initial_event_required,public\.order_events_initial_exact immediate/);
  assert.doesNotMatch(body, /set constraints orders_initial_event_required/);
  assert.doesNotMatch(body, /set constraints all immediate/);
  assert.match(body, /status='order_created'/);
  assert.match(body, /status='converted'/);
});

test("reservation lock precedes inventory lock and submission does not move stock", () => {
  const start = lower.indexOf("create function public.submit_native_checkout(");
  const body = lower.slice(start, lower.indexOf("end $$;", start) + 7);
  assert.ok(body.indexOf("order by i.line_number,r.id for update of r") < body.indexOf("for key share of l"));
  assert.match(body, /link_inventory_reservation_to_order_item/);
  assert.doesNotMatch(body, /confirm_inventory_reservation|insert into public\.inventory_movements|update public\.inventory_levels/);
});

test("M29 has no payment, publication, external calls, dynamic SQL, or broad grants", () => {
  assert.doesNotMatch(lower, /woocommerce|olist|pagbank|mercadopago|http_post|net\.http|execute format|execute immediate/);
  assert.doesNotMatch(lower, /grant execute[\s\S]*to (public|anon|authenticated|persi_worker|persi_readonly)/);
  assert.match(lower, /to persi_app;/);
  assert.doesNotMatch(lower, /to persi_worker;[\s\S]*create_native_cart/);
});

test("nullable inputs are explicit and all commerce arithmetic remains bigint", () => {
  assert.doesNotMatch(lower, /submit_native_checkout\([\s\S]*?\) returns[\s\S]*?strict/);
  assert.match(lower, /num_nonnulls\(p_tax_id_type,p_tax_id_ciphertext,p_tax_id_fingerprint,p_tax_id_masked\) not in \(0,4\)/);
  assert.match(lower, /p_billing_address is null/);
  assert.match(lower, /p_shipping_address is null/);
  assert.doesNotMatch(lower, /double precision|real|numeric\(/);
});

test("candidate remains a single migration and contains balanced PLpgSQL delimiters", () => {
  assert.equal((sql.match(/\$\$/g) ?? []).length % 2, 0);
  assert.equal((lower.match(/language plpgsql/g) ?? []).length, (lower.match(/end \$\$;/g) ?? []).length);
  assert.doesNotMatch(lower, /create table public\.payments|create table public\.shipments/);
});
