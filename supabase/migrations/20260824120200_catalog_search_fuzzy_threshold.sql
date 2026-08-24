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
       or extensions.similarity(d.name_normalized,i.q)>=0.2 group by d.product_id
  ) select r.product_id,r.score from ranked r join products p on p.id=r.product_id
    where p.status='active' order by r.score desc,r.product_id limit greatest(1,least(result_limit,100));
$$;
