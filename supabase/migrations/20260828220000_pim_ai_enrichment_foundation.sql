alter table public.pim_suggestions
  add column suggestion_type text not null default 'field',
  add column payload jsonb not null default '{}'::jsonb,
  add column provider text not null default 'deterministic',
  add column model_version text not null default 'rules-v1',
  add column prompt_version text not null default 'pim-enrichment-v1',
  add column source_fingerprint text not null default '',
  add column extraction_method text not null default 'deterministic',
  add column evidence_references jsonb not null default '[]'::jsonb,
  add column input_tokens integer,
  add column output_tokens integer,
  add column estimated_cost_minor bigint,
  add column superseded_at timestamptz,
  add constraint pim_suggestion_payload_check check (jsonb_typeof(payload) = 'object'),
  add constraint pim_suggestion_evidence_check check (jsonb_typeof(evidence_references) = 'array'),
  add constraint pim_suggestion_fingerprint_check check (source_fingerprint = '' or source_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint pim_suggestion_usage_check check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and (estimated_cost_minor is null or estimated_cost_minor >= 0)
  );

create unique index pim_suggestions_active_fingerprint_unique
  on public.pim_suggestions(product_id, field_name, source_fingerprint, provider, model_version, prompt_version)
  where status = 'needs_review' and superseded_at is null and source_fingerprint <> '';

create index pim_suggestions_product_created_idx
  on public.pim_suggestions(product_id, created_at desc, id);

comment on column public.pim_suggestions.payload is
  'Validated structured suggestion payload. Source content is data and never executable instructions.';
comment on column public.pim_suggestions.source_fingerprint is
  'SHA-256 of the canonical source context used to produce this suggestion.';
comment on column public.pim_suggestions.superseded_at is
  'Marks a retained suggestion as superseded without deleting its review history.';
