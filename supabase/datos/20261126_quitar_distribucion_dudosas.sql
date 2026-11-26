-- Mario (26-11): quitar del catálogo maestro lo del catálogo DISTRIBUCIÓN de Osmofilter.
-- Dudosas (MI0003, MI0038, MI0039): Mario «de distribución no quiero nada» → fuera también.
do $$
begin
  if exists (select 1 from public.products p join public.catalog_products c on c.id = p.catalog_product_id
             where c.supplier_reference in ('MI0003','MI0038','MI0039')) then
    raise exception 'Alguna empresa tiene importada una de estas refs';
  end if;
end $$;
delete from public.catalog_product_compatibilities
 where equipment_catalog_id in (select id from public.catalog_products where supplier_reference in ('MI0003','MI0038','MI0039'));
delete from public.catalog_products
 where supplier_reference in ('MI0003','MI0038','MI0039')
   and origen_carga = 'osmofilter-residencial-2026-11-26';
