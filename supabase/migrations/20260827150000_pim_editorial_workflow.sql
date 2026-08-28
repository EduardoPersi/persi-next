alter type public.pim_workflow_status add value if not exists 'draft' after 'needs_enrichment';

alter table public.pim_product_profiles
  add column version bigint not null default 0,
  add column image_alt_text text,
  add column approved_content jsonb,
  add column draft_started_at timestamptz,
  add column submitted_at timestamptz,
  add column rejected_at timestamptz,
  add constraint pim_profile_version_check check (version >= 0),
  add constraint pim_profile_approved_content_check check (
    approved_content is null or (
      jsonb_typeof(approved_content) = 'object'
      and jsonb_typeof(approved_content -> 'bulletPoints') = 'array'
      and jsonb_typeof(approved_content -> 'searchTerms') = 'array'
    )
  );

create index pim_product_profiles_version_idx
  on public.pim_product_profiles(product_id, version);

comment on column public.pim_product_profiles.approved_content is
  'Immutable editorial snapshot from the last human approval. Current editorial columns remain the editable draft.';
comment on column public.pim_product_profiles.version is
  'Optimistic concurrency token incremented by every persisted editorial action.';
