begin;
select plan(12);

select has_table('public','pim_conflicts','pim conflicts table exists');
select has_column('public','pim_conflicts','product_id','product reference exists');
select has_column('public','pim_conflicts','attribute_key','attribute key exists');
select has_column('public','pim_conflicts','conflict_type','conflict type exists');
select has_column('public','pim_conflicts','status','workflow status exists');
select has_column('public','pim_conflicts','source_fingerprint','source freshness identity exists');
select has_column('public','pim_conflicts','evidence_fingerprint','evidence identity exists');
select has_column('public','pim_conflicts','metadata','structured evidence exists');
select col_is_pk('public','pim_conflicts','id','id is the primary key');
select fk_ok('public','pim_conflicts','product_id','public','products','id','product foreign key is valid');
select indexes_are('public','pim_conflicts',array['pim_conflicts_logical_identity_unique','pim_conflicts_open_queue_idx','pim_conflicts_pkey','pim_conflicts_product_idx'],'expected conflict indexes exist');
select ok((select relrowsecurity from pg_class where oid='public.pim_conflicts'::regclass),'RLS is enabled');

select * from finish();
rollback;
