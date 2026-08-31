begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
insert into public.products(id,name,slug) values('93000000-0000-4000-8000-000000000001','P3 pgTAP fixture','p3-pgtap-fixture');

select has_column('public','pim_suggestions','payload','structured payload exists');
select has_column('public','pim_suggestions','source_fingerprint','fingerprint exists');
select has_column('public','pim_suggestions','evidence_references','evidence references exist');
select has_column('public','pim_suggestions','provider','provider exists');
select has_column('public','pim_suggestions','model_version','model version exists');
select has_column('public','pim_suggestions','prompt_version','prompt version exists');
select has_column('public','pim_suggestions','superseded_at','superseded marker exists');
select has_index('public','pim_suggestions','pim_suggestions_active_fingerprint_unique','active fingerprint is unique');
select has_index('public','pim_suggestions','pim_suggestions_product_created_idx','product history is indexed');
select col_type_is('public','pim_suggestions','payload','jsonb','payload is jsonb');
select col_type_is('public','pim_suggestions','estimated_cost_minor','bigint','cost uses integer minor units');
select is((select count(*) from pg_policies where schemaname='public' and tablename='pim_suggestions'),0::bigint,'no public policy');
select ok((select relrowsecurity from pg_class where oid='public.pim_suggestions'::regclass),'RLS remains enabled');
select throws_ok($$insert into pim_suggestions(product_id,field_name,suggested_value,source,source_fingerprint) values('93000000-0000-4000-8000-000000000001','voltage','220V','ai','invalid')$$,'23514',null,'invalid fingerprint rejected');

select * from finish();
rollback;
