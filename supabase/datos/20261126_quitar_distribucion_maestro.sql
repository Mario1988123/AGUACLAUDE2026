-- Mario (26-11): quitar del catálogo maestro lo del catálogo DISTRIBUCIÓN de Osmofilter.
-- Lista de osmonova (variantes de refs de Distribución). Recién cargadas el 26-11; se comprueba que ninguna empresa las tiene.
do $$
begin
  if exists (select 1 from public.products p join public.catalog_products c on c.id = p.catalog_product_id
             where c.supplier_reference in ('HA0009S','HA0018S','HA0026S','MI0035S','MI0006','MI0009','MI0016','MI0032')) then
    raise exception 'Alguna empresa tiene importada una de estas refs';
  end if;
end $$;
delete from public.catalog_product_compatibilities
 where equipment_catalog_id in (select id from public.catalog_products where supplier_reference in ('HA0009S','HA0018S','HA0026S','MI0035S','MI0006','MI0009','MI0016','MI0032'));
delete from public.catalog_products
 where supplier_reference in ('HA0009S','HA0018S','HA0026S','MI0035S','MI0006','MI0009','MI0016','MI0032')
   and origen_carga = 'osmofilter-residencial-2026-11-26';
