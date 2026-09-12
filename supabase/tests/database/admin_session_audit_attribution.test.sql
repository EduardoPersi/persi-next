begin;
select plan(15);

select has_column('public','pim_audit_log','admin_session_id','PIM audit has native session attribution');
select col_type_is('public','pim_audit_log','admin_session_id','uuid','native session attribution is uuid');
select col_is_null('public','pim_audit_log','admin_session_id','legacy and non-admin audit remains nullable');
select fk_ok('public','pim_audit_log','admin_session_id','public','admin_sessions','id','PIM audit references native session');
select has_index('public','pim_audit_log','pim_audit_log_admin_session_idx','native session audit lookup is indexed');
select ok((select relrowsecurity from pg_class where oid='public.pim_audit_log'::regclass),'PIM audit RLS remains enabled');
select is((select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='pim_audit_log' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')),0::bigint,'browser roles cannot mutate PIM audit');
select is((select confdeltype::text from pg_constraint where conrelid='public.pim_audit_log'::regclass and conname='pim_audit_log_admin_session_id_fkey'),'r'::text,'session deletion uses explicit RESTRICT semantics');

insert into public.admin_memberships(id,identity_provider,identity_subject,role,status,created_by)
values('a2200000-0000-4000-8000-000000000036','supabase_auth','a2200000-0000-4000-8000-000000000001','ADMIN','active','pgtap');
insert into public.admin_sessions(id,identity_provider,identity_subject,capability_hash,expires_at,idle_expires_at,mfa_verified_at)
values('a2200000-0000-4000-8000-000000000037','supabase_auth','a2200000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '8 hours',now()+interval '30 minutes',now());

select lives_ok($$insert into public.pim_audit_log(entity_type,entity_id,source,actor_reference,operation,actor_identity_provider,actor_identity_subject,admin_session_id,admin_membership_id,effective_role,correlation_id) values('qualification','a2200000-0000-4000-8000-000000000038','manual','pgtap','QUALIFY','supabase_auth','a2200000-0000-4000-8000-000000000001','a2200000-0000-4000-8000-000000000037','a2200000-0000-4000-8000-000000000036','ADMIN','a2200000-0000-4000-8000-000000000039')$$,'coherent protected audit tuple can be recorded');
select is((select admin_session_id from public.pim_audit_log where correlation_id='a2200000-0000-4000-8000-000000000039'), 'a2200000-0000-4000-8000-000000000037'::uuid,'audit retains exact session id');
select throws_ok($$delete from public.admin_sessions where id='a2200000-0000-4000-8000-000000000037'$$,'23503',null,'session cannot be deleted while audit refers to it');
update public.admin_sessions set revoked_at=now(),revocation_reason='qualification' where id='a2200000-0000-4000-8000-000000000037';
select is((select count(*) from public.pim_audit_log where correlation_id='a2200000-0000-4000-8000-000000000039'),1::bigint,'audit survives session revocation');
select is((select count(*) from public.admin_sessions where id='a2200000-0000-4000-8000-000000000037' and revoked_at is null),0::bigint,'revoked session is no longer active');
select lives_ok($$insert into public.pim_audit_log(entity_type,entity_id,source,actor_reference,operation) values('legacy','a2200000-0000-4000-8000-000000000040','manual','legacy','LEGACY')$$,'legacy non-session audit remains supported');
select is((select count(*) from public.pim_audit_log where entity_id='a2200000-0000-4000-8000-000000000040' and admin_session_id is null),1::bigint,'legacy audit has explicit NULL session semantics');

select * from finish();
rollback;
