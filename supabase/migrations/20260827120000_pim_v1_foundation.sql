create type public.pim_workflow_status as enum ('raw','normalized','needs_enrichment','ai_suggested','needs_review','approved','rejected','published');
create type public.pim_source as enum ('olist','woocommerce','manufacturer','manual','ai','migration','external_reference');
create type public.pim_decision_status as enum ('needs_review','approved','rejected');

create table public.pim_product_profiles (
  product_id uuid primary key references public.products(id) on delete cascade,
  workflow_status public.pim_workflow_status not null default 'raw', commercial_name text, short_description text, description text,
  bullet_points text[] not null default '{}', application text, specifications text, seo_title text, meta_description text,
  search_terms text[] not null default '{}', synonyms text[] not null default '{}', review_notes text,
  approved_at timestamptz, published_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint pim_profile_approval_check check (workflow_status not in ('approved','published') or approved_at is not null),
  constraint pim_profile_publish_check check (workflow_status <> 'published' or published_at is not null)
);
create index pim_product_profiles_workflow_idx on public.pim_product_profiles(workflow_status,updated_at,product_id);

create table public.pim_attribute_reviews (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete cascade, attribute_id uuid not null references public.attributes(id) on delete restrict,
  attribute_value_id uuid not null references public.attribute_values(id) on delete restrict, source public.pim_source not null,
  status public.pim_decision_status not null default 'needs_review', confidence numeric(5,4), source_reference text, evidence text,
  reviewed_by text, reviewed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint pim_attribute_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint pim_attribute_decision_check check (status='needs_review' or (reviewed_by is not null and reviewed_at is not null)),
  constraint pim_attribute_reviews_assignment_unique unique(product_id,attribute_id,attribute_value_id)
);
create index pim_attribute_reviews_queue_idx on public.pim_attribute_reviews(status,created_at);

create table public.pim_suggestions (
  id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products(id) on delete cascade,
  field_name text not null check (field_name ~ '^[a-z][a-z0-9_]*$'), suggested_value text not null,
  source public.pim_source not null, confidence numeric(5,4), status public.pim_decision_status not null default 'needs_review',
  evidence text, provider_reference text, reviewed_by text, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint pim_suggestion_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint pim_suggestion_ai_review_check check (source <> 'ai' or status <> 'approved' or reviewed_by is not null),
  constraint pim_suggestion_decision_check check (status='needs_review' or (reviewed_by is not null and reviewed_at is not null))
);
create index pim_suggestions_queue_idx on public.pim_suggestions(status,created_at,product_id);

create table public.pim_audit_log (
  id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id) on delete restrict,
  entity_type text not null, entity_id uuid not null, field_name text, previous_value text, new_value text,
  source public.pim_source not null, actor_reference text not null, operation text not null, reason text, created_at timestamptz not null default now()
);
create index pim_audit_log_entity_idx on public.pim_audit_log(entity_type,entity_id,created_at desc);
create index pim_audit_log_product_idx on public.pim_audit_log(product_id,created_at desc);

create trigger pim_product_profiles_set_updated_at before update on public.pim_product_profiles for each row execute function public.set_updated_at();
create trigger pim_attribute_reviews_set_updated_at before update on public.pim_attribute_reviews for each row execute function public.set_updated_at();
create trigger pim_suggestions_set_updated_at before update on public.pim_suggestions for each row execute function public.set_updated_at();

alter table public.pim_product_profiles enable row level security;
alter table public.pim_attribute_reviews enable row level security;
alter table public.pim_suggestions enable row level security;
alter table public.pim_audit_log enable row level security;
