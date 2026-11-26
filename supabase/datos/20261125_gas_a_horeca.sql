-- Gas pasa a Horeca (pedido de Mario, 2026-11-25). Se ejecuta en UNA transacción (aplicar-migracion.sh).
-- Copia previa: supabase/datos/respaldo-gas-a-horeca-2026-11-25.json
-- No sube catalog_products.version: no salta ningún aviso de actualización.

-- ── INFINITY AQUA ────────────────────────────────────────────────────────────
-- 1. ECO25 ÉLITE: a su categoría Horeca, como equipo de tipo horeca (sin mantenimiento propio).
--    Nombre, precio, descripciones, fotos, roles y enlace al maestro NO se tocan.
update public.products
   set category_id = 'd62a00e1-6494-45db-9276-7a2778faebe5',
       kind = 'equipment',
       tipo_equipo = 'horeca'
 where id = 'acc40c3e-fb9c-47b8-85e7-e8d31c979609'
   and company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c';

-- 2. Sus 2 equipos de cliente: siguen colgados de su ósmosis / COMPACT, ahora como complemento.
update public.customer_equipment
   set pack_role = 'complemento',
       tipo_equipo = 'horeca'
 where product_id = 'acc40c3e-fb9c-47b8-85e7-e8d31c979609'
   and company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
   and parent_equipment_id is not null;

-- 3. Su categoría Horeca pasa a tipo horeca (los Horeca nuevos nacen sin mantenimiento).
update public.product_categories
   set tipo_equipo = 'horeca'
 where id = 'd62a00e1-6494-45db-9276-7a2778faebe5'
   and company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c';

-- 4. Su categoría Gas desaparece (ya sin productos; comprobado: nada más cuelga de ella).
do $$
begin
  if exists (select 1 from public.products where category_id = 'b01fb626-9fc3-4575-85a8-d445dfbe7b91') then
    raise exception 'La categoría Gas de Infinity aún tiene productos';
  end if;
end $$;
delete from public.product_categories
 where id = 'b01fb626-9fc3-4575-85a8-d445dfbe7b91'
   and company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c';

-- ── CATÁLOGO MAESTRO ─────────────────────────────────────────────────────────
-- 5. HO1128 (ECO25 ÉLITE) a Horeca como equipo.
update public.catalog_products
   set category_global_key = 'horeca', kind = 'equipment'
 where supplier_reference = 'HO1128';

-- 6. Categoría global Gas desaparece (sin productos ni atributos enlazados).
do $$
begin
  if exists (select 1 from public.catalog_products where category_global_key = 'Gas') then
    raise exception 'Quedan productos maestros en Gas';
  end if;
end $$;
delete from public.product_categories_global where key = 'Gas';

-- 7. Reglas de complemento por categoría: cualquier Horeca con cualquier ósmosis / UF, en las dos direcciones.
update public.product_categories_global set complementa_keys = array['osmosis*','filters'] where key = 'horeca';
update public.product_categories_global set complementa_keys = array['horeca'] where key in ('osmosis','filters');

-- 8. Que la descripción diga si es con o sin gas (según el atributo «Agua con gas»).
update public.catalog_products c
   set short_description = case
         when c.short_description ~ '^Enfriador HORECA con '
           then regexp_replace(c.short_description, '^Enfriador HORECA con ',
                'Enfriador HORECA ' || case when v.value_boolean then 'con gas' else 'sin gas' end || ', con ')
         when c.short_description = 'Enfriador HORECA'
           then 'Enfriador HORECA ' || case when v.value_boolean then 'con gas' else 'sin gas' end
         else c.short_description || case when v.value_boolean then ', con gas' else ', sin gas' end
       end
  from public.catalog_product_attributes v
 where v.catalog_product_id = c.id
   and v.attribute_global_key = 'dispenser_sparkling_water'
   and v.value_boolean is not null
   and c.short_description is not null
   and c.short_description !~* 'gas';
