create or replace function public.refresh_catalog_search_document(target_product_id uuid)
returns void language sql security invoker set search_path=public as $$
  insert into catalog_search_documents(product_id,sku_normalized,gtin,name_normalized,brand_normalized,document,updated_at)
  select p.id,v.sku_normalized,v.gtin,immutable_unaccent_lower(p.name),immutable_unaccent_lower(coalesce(b.name,'')),
    immutable_unaccent_lower(concat_ws(' ',p.name,p.short_description,p.description,b.name,
      (select string_agg(c.name,' ') from product_categories pc join categories c on c.id=pc.category_id where pc.product_id=p.id),
      (select string_agg(av.display_value,' ') from product_attribute_values pav join attribute_values av on av.id=pav.attribute_value_id where pav.product_id=p.id))),now()
  from products p
  join lateral (select pv.sku_normalized,pv.gtin from product_variants pv where pv.product_id=p.id order by pv.created_at,pv.id limit 1) v on true
  left join brands b on b.id=p.brand_id where p.id=target_product_id
  on conflict(product_id) do update set sku_normalized=excluded.sku_normalized,gtin=excluded.gtin,name_normalized=excluded.name_normalized,
    brand_normalized=excluded.brand_normalized,document=excluded.document,updated_at=excluded.updated_at
  where (catalog_search_documents.sku_normalized,catalog_search_documents.gtin,catalog_search_documents.name_normalized,catalog_search_documents.brand_normalized,catalog_search_documents.document)
    is distinct from (excluded.sku_normalized,excluded.gtin,excluded.name_normalized,excluded.brand_normalized,excluded.document);
$$;
