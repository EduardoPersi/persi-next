create table public.catalog_search_documents (
  product_id uuid primary key references public.products(id) on delete cascade,
  sku_normalized text not null,
  gtin text,
  name_normalized text not null,
  brand_normalized text not null default '',
  document text not null,
  updated_at timestamptz not null default now()
);

create index catalog_search_documents_sku_idx on public.catalog_search_documents(sku_normalized);
create index catalog_search_documents_gtin_idx on public.catalog_search_documents(gtin) where gtin is not null;
create index catalog_search_documents_name_trgm_idx on public.catalog_search_documents using gin(name_normalized extensions.gin_trgm_ops);
create index catalog_search_documents_document_trgm_idx on public.catalog_search_documents using gin(document extensions.gin_trgm_ops);
alter table public.catalog_search_documents enable row level security;

create function public.refresh_catalog_search_document(target_product_id uuid)
returns void language sql security invoker set search_path=public as $$
  insert into catalog_search_documents(product_id,sku_normalized,gtin,name_normalized,brand_normalized,document,updated_at)
  select p.id,v.sku_normalized,v.gtin,immutable_unaccent_lower(p.name),immutable_unaccent_lower(coalesce(b.name,'')),
    immutable_unaccent_lower(concat_ws(' ',p.name,p.short_description,p.description,b.name,
      (select string_agg(c.name,' ') from product_categories pc join categories c on c.id=pc.category_id where pc.product_id=p.id),
      (select string_agg(av.display_value,' ') from product_attribute_values pav join attribute_values av on av.id=pav.attribute_value_id where pav.product_id=p.id))),now()
  from products p join product_variants v on v.product_id=p.id left join brands b on b.id=p.brand_id where p.id=target_product_id
  on conflict(product_id) do update set sku_normalized=excluded.sku_normalized,gtin=excluded.gtin,name_normalized=excluded.name_normalized,
    brand_normalized=excluded.brand_normalized,document=excluded.document,updated_at=excluded.updated_at
  where (catalog_search_documents.sku_normalized,catalog_search_documents.gtin,catalog_search_documents.name_normalized,catalog_search_documents.brand_normalized,catalog_search_documents.document)
    is distinct from (excluded.sku_normalized,excluded.gtin,excluded.name_normalized,excluded.brand_normalized,excluded.document);
$$;

select public.refresh_catalog_search_document(p.id) from public.products p;

create or replace function public.catalog_search(search_query text, result_limit integer default 20)
returns table(product_id uuid, score numeric)
language sql stable security invoker set search_path = public
as $$
  with input as (select immutable_unaccent_lower(btrim(search_query)) q), expanded as (
    select q term from input union
    select replace(i.q,hit.normalized_alias,replacement.normalized_alias) from input i
    join catalog_search_synonyms hit on i.q like '%'||hit.normalized_alias||'%'
    join catalog_search_synonyms replacement on replacement.group_code=hit.group_code
  ), ranked as (
    select d.product_id,max(
      (case when immutable_unaccent_lower(d.sku_normalized)=i.q then 3000 else 0 end)+
      (case when immutable_unaccent_lower(d.gtin)=i.q then 2900 else 0 end)+
      (case when d.name_normalized=i.q then 1000 else 0 end)+
      (case when d.name_normalized like i.q||'%' then 600 else 0 end)+
      (case when d.name_normalized like '%'||i.q||'%' then 400 else 0 end)+
      (case when d.brand_normalized like '%'||i.q||'%' then 250 else 0 end)+
      (case when d.document like '%'||e.term||'%' then 80 else 0 end)+
      extensions.similarity(d.name_normalized,i.q)*100)::numeric score
    from catalog_search_documents d cross join input i cross join expanded e
    where d.document like '%'||e.term||'%' or d.sku_normalized=upper(btrim(search_query)) or d.gtin=btrim(search_query)
       or d.name_normalized operator(extensions.%) i.q group by d.product_id
  ) select r.product_id,r.score from ranked r join products p on p.id=r.product_id
    where p.status='active' order by r.score desc,r.product_id limit greatest(1,least(result_limit,100));
$$;
