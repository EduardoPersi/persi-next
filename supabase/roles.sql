-- Canonical Supabase pre-migration bootstrap for the public-schema RLS guard.
-- The Supabase CLI loads this file before applying project migrations.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $rls_auto_enable$
declare
  command record;
begin
  for command in
    select *
    from pg_catalog.pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if command.schema_name = 'public' then
      execute pg_catalog.format(
        'alter table if exists %s enable row level security',
        command.object_identity
      );
    end if;
  end loop;
end
$rls_auto_enable$;

alter function public.rls_auto_enable() owner to postgres;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();
alter event trigger ensure_rls owner to postgres;
