-- M31: make checkout submission ownership authorization binary and fail-closed.
-- M29 is intentionally preserved; this forward-only migration changes only its
-- existing submit_native_checkout implementation.

do $migration$
declare
  signature constant regprocedure :=
    'public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)'::regprocedure;
  definition text;
  vulnerable constant text := $old$if not ((p_customer_id is not null and p_guest_fingerprint is null and s.customer_id=p_customer_id and c.customer_id=p_customer_id) or
          (p_customer_id is null and p_guest_fingerprint is not null and s.customer_id is null and c.customer_id is null and c.guest_token_fingerprint=p_guest_fingerprint)) then$old$;
  hardened constant text := $new$if (((p_customer_id is not null and p_guest_fingerprint is null and s.customer_id=p_customer_id and c.customer_id=p_customer_id) or
          (p_customer_id is null and p_guest_fingerprint is not null and s.customer_id is null and c.customer_id is null and c.guest_token_fingerprint=p_guest_fingerprint))) is not true then$new$;
begin
  select pg_get_functiondef(signature) into strict definition;
  if length(definition)-length(replace(definition,vulnerable,'')) <> length(vulnerable) then
    raise exception using errcode='55000',message='M31_EXPECTED_AUTHORITY_PREDICATE_NOT_UNIQUE';
  end if;
  definition := replace(definition,vulnerable,hardened);
  execute definition;
end
$migration$;

alter function public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)
  owner to postgres;

revoke all on function public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)
  from public,anon,authenticated,persi_app,persi_worker,persi_readonly;
grant execute on function public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)
  to persi_app;

comment on function public.submit_native_checkout(uuid,bigint,text,text,uuid,text,text,text,uuid,uuid,text,text,text,jsonb,jsonb,text,text,text,text)
  is 'Server-only atomic ready-checkout to pending-order boundary; M31 null-safe fail-closed ownership authorization; no payment, stock confirmation, publication, or external integration.';
