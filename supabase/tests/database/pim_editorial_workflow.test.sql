begin;
select plan(22);

select ok('draft'=any(enum_range(null::pim_workflow_status)::text[]),'draft workflow state exists');
select has_column('public','pim_product_profiles','version','optimistic version exists');
select has_column('public','pim_product_profiles','approved_content','approved snapshot exists');
select has_column('public','pim_product_profiles','image_alt_text','editorial alt text exists');
select has_column('public','pim_product_profiles','draft_started_at','draft timestamp exists');

insert into products(id,name,slug) values('91000000-0000-0000-0000-000000000001','SOURCE 25mm x 1/2" 127V 20A 500W','pim-p2-source');
insert into product_variants(id,product_id,sku,gtin) values('92000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','PIM-P2-SKU','7891234567890');

select lives_ok($$insert into pim_product_profiles(product_id,workflow_status,commercial_name,description,bullet_points,search_terms,image_alt_text,version,draft_started_at)
 values('91000000-0000-0000-0000-000000000001','draft','DRAFT 16mm x 1/2"','32mm x 3/4" e 32 x 25mm',array['3/4"','20mm'],array['220V'], 'Produto 500W',1,now())$$,'create draft');
select is((select workflow_status::text from pim_product_profiles where product_id='91000000-0000-0000-0000-000000000001'),'draft','created as draft');
select is((select version from pim_product_profiles where product_id='91000000-0000-0000-0000-000000000001'),1::bigint,'version starts at one');

update pim_product_profiles set workflow_status='needs_review',version=version+1,submitted_at=now() where product_id='91000000-0000-0000-0000-000000000001';
select is((select workflow_status::text from pim_product_profiles where product_id='91000000-0000-0000-0000-000000000001'),'needs_review','submit review');

update pim_product_profiles set workflow_status='approved',approved_content=jsonb_build_object('commercialName',commercial_name,'shortDescription',short_description,'description',description,'bulletPoints',bullet_points,'application',application,'specifications',specifications,'seoTitle',seo_title,'metaDescription',meta_description,'searchTerms',search_terms,'imageAltText',image_alt_text),approved_at=now(),version=version+1 where product_id='91000000-0000-0000-0000-000000000001';
select is((select workflow_status::text from pim_product_profiles where product_id='91000000-0000-0000-0000-000000000001'),'approved','approve');
select is((select approved_content->>'commercialName' from pim_product_profiles where product_id='91000000-0000-0000-0000-000000000001'),'DRAFT 16mm x 1/2"','approved snapshot captured');

update pim_product_profiles set workflow_status='draft',commercial_name='NEW DRAFT 20mm',version=version+1 where product_id='91000000-0000-0000-0000-000000000001';
select is((select approved_content->>'commercialName' from pim_product_profiles where product_id='91000000-0000-0000-0000-000000000001'),'DRAFT 16mm x 1/2"','approved remains immutable after reopen');
select is((select commercial_name from pim_product_profiles where product_id='91000000-0000-0000-0000-000000000001'),'NEW DRAFT 20mm','new draft is separate');

update pim_product_profiles set workflow_status='needs_review',version=version+1 where product_id='91000000-0000-0000-0000-000000000001';
update pim_product_profiles set workflow_status='rejected',rejected_at=now(),version=version+1 where product_id='91000000-0000-0000-0000-000000000001';
select is((select workflow_status::text from pim_product_profiles where product_id='91000000-0000-0000-0000-000000000001'),'rejected','reject');
update pim_product_profiles set workflow_status='draft',version=version+1 where product_id='91000000-0000-0000-0000-000000000001';
select is((select workflow_status::text from pim_product_profiles where product_id='91000000-0000-0000-0000-000000000001'),'draft','reopen rejected');

insert into pim_audit_log(product_id,entity_type,entity_id,field_name,previous_value,new_value,source,actor_reference,operation)
select product_id,'editorial_profile',product_id,'editorial_content','{}','{}','manual','wp:test',operation
from (values('CREATE_DRAFT'),('UPDATE_DRAFT'),('SUBMIT_REVIEW'),('APPROVE'),('REJECT'),('REOPEN'),('DISCARD_DRAFT')) x(operation)
cross join (select product_id from pim_product_profiles where product_id='91000000-0000-0000-0000-000000000001') p;
select is((select count(*) from pim_audit_log where product_id='91000000-0000-0000-0000-000000000001'),7::bigint,'all editorial actions are auditable');
select is((select name from products where id='91000000-0000-0000-0000-000000000001'),'SOURCE 25mm x 1/2" 127V 20A 500W','source name is immutable');
select is((select sku from product_variants where id='92000000-0000-0000-0000-000000000001'),'PIM-P2-SKU','operational SKU is immutable');
select is((select gtin from product_variants where id='92000000-0000-0000-0000-000000000001'),'7891234567890','operational GTIN is immutable');
select is((select count(*) from prices where product_variant_id='92000000-0000-0000-0000-000000000001'),0::bigint,'price is untouched');
select is((select count(*) from inventory_levels where product_variant_id='92000000-0000-0000-0000-000000000001'),0::bigint,'stock is untouched');
select is((select count(*) from inventory_movements im join inventory_levels il on il.id=im.inventory_level_id where il.product_variant_id='92000000-0000-0000-0000-000000000001'),0::bigint,'inventory movements are untouched');

select * from finish();
rollback;
