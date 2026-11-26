-- Reparar las CARACTERÍSTICAS de los productos ya importados del catálogo maestro
-- (2026-11-26). SIN APLICAR: lo revisa el coordinador y se lo enseña a Mario.
--
-- Por qué hace falta (comprobado con SELECT en producción el 26-11):
--   Los 14 productos enganchados al maestro (13 de INFINITY AQUA y 1 de aquaroo)
--   se importaron entre junio y agosto, cuando el maestro aún no tenía las
--   características de Osmofilter. El 25-11 se cargaron en el maestro SIN subir
--   `version` (decisión de Mario, para no lanzar avisos), así que «Aplicar
--   actualización» nunca se ofreció y la empresa se quedó con lo de entonces:
--   Infinity Indic 0 de 38, ECO25 0 de 27, Basic S 7 de 37, Zagreb 0 de 8…
--   Además los atributos de empresa tienen `grupo` NULL (los 60 de Infinity) y
--   todo salía en «Técnicas».
--
-- Qué hace (idempotente: se puede lanzar dos veces sin duplicar nada):
--   1. Crea en la empresa los atributos del maestro que le falten (misma
--      categoría que el producto, clonados del global, con su grupo).
--   2. Rellena `grupo` en los atributos de empresa clonados de un global que lo
--      tienen vacío (solo NULL → grupo del global; no cambia ninguno puesto).
--   3. AÑADE a cada producto enganchado los valores del maestro que NO tenga.
--      Un valor que la empresa ya tenga para ese atributo NO se toca, aunque sea
--      distinto (Basic S conserva sus 230 V, 55 Hz y 2 L: corregirlos es cosa
--      de Infinity, desde Editar → Características).
--   4. Si la migración 20261129110000 (columna `origen`) ya está aplicada, marca
--      los valores añadidos como origen = 'maestro'.
--   Todo lo creado queda apuntado en backup_limpieza.* para poder deshacerlo.
-- No toca nombres, precios, descripciones, fotos ni documentos. No borra nada.
--
-- DESHACER (si hiciera falta):
--   delete from public.product_attribute_values
--    where id in (select valor_id from backup_limpieza.reparar_atributos_20261126_valores);
--   delete from public.product_attributes
--    where id in (select attribute_id from backup_limpieza.reparar_atributos_20261126_atributos where creado);
--   update public.product_attributes set grupo = null
--    where id in (select attribute_id from backup_limpieza.reparar_atributos_20261126_atributos where not creado);

begin;

create table if not exists backup_limpieza.reparar_atributos_20261126_valores (
  valor_id uuid primary key,
  product_id uuid not null,
  company_id uuid not null,
  attribute_id uuid not null,
  hecho_en timestamptz not null default now()
);
create table if not exists backup_limpieza.reparar_atributos_20261126_atributos (
  attribute_id uuid primary key,
  company_id uuid not null,
  creado boolean not null,          -- true = creado aquí; false = solo se le rellenó el grupo
  hecho_en timestamptz not null default now()
);

-- Productos enganchados al maestro y los valores que trae su maestro.
create temp table _maestro on commit drop as
select p.id           as product_id,
       p.company_id,
       p.category_id,
       g.id           as global_id,
       g.key,
       g.name_es,
       g.data_type,
       g.unit,
       g.enum_values,
       g.grupo,
       g.sort_order,
       a.value_text,
       a.value_number,
       a.value_boolean,
       a.display_order
from public.products p
join public.catalog_products cp on cp.id = p.catalog_product_id
join public.catalog_product_attributes a on a.catalog_product_id = cp.id
join public.product_attributes_global g on g.key = a.attribute_global_key
where p.deleted_at is null;

-- 1. Atributos de empresa que faltan (uno por empresa + categoría + global).
with faltan as (
  select distinct on (m.company_id, m.category_id, m.global_id)
         m.company_id, m.category_id, m.global_id, m.key, m.name_es, m.data_type,
         m.unit, m.enum_values, m.grupo, m.sort_order
  from _maestro m
  where not exists (
    select 1 from public.product_attributes la
    where la.company_id = m.company_id
      and la.category_id is not distinct from m.category_id
      and (la.cloned_from_global_id = m.global_id or la.key = m.key)
  )
  order by m.company_id, m.category_id, m.global_id
),
creados as (
  insert into public.product_attributes
    (company_id, category_id, cloned_from_global_id, key, name, data_type, unit, enum_values,
     grupo, sort_order, default_visible)
  select f.company_id, f.category_id, f.global_id, f.key, f.name_es, f.data_type::app.attribute_data_type,
         f.unit, f.enum_values, f.grupo, coalesce(f.sort_order, 0), true
  from faltan f
  on conflict (company_id, category_id, key) do nothing
  returning id, company_id
)
insert into backup_limpieza.reparar_atributos_20261126_atributos (attribute_id, company_id, creado)
select id, company_id, true from creados
on conflict (attribute_id) do nothing;

-- 2. Grupo vacío en atributos de empresa clonados de un global.
with rellenados as (
  update public.product_attributes la
     set grupo = g.grupo
    from public.product_attributes_global g
   where g.id = la.cloned_from_global_id
     and la.grupo is null
     and g.grupo is not null
  returning la.id, la.company_id
)
insert into backup_limpieza.reparar_atributos_20261126_atributos (attribute_id, company_id, creado)
select id, company_id, false from rellenados
on conflict (attribute_id) do nothing;

-- 3. Valores del maestro que el producto no tiene.
with destino as (
  select m.*,
         (select la.id
            from public.product_attributes la
           where la.company_id = m.company_id
             and la.category_id is not distinct from m.category_id
             and (la.cloned_from_global_id = m.global_id or la.key = m.key)
           order by (la.cloned_from_global_id = m.global_id) desc nulls last, la.created_at
           limit 1) as attribute_id
  from _maestro m
),
nuevos as (
  insert into public.product_attribute_values
    (product_id, attribute_id, company_id, value_text, value_number, value_boolean,
     is_visible, is_featured, display_order)
  select d.product_id, d.attribute_id, d.company_id, d.value_text, d.value_number, d.value_boolean,
         true, false, d.display_order
  from destino d
  where d.attribute_id is not null
    and not exists (
      select 1 from public.product_attribute_values v
      where v.product_id = d.product_id and v.attribute_id = d.attribute_id
    )
  on conflict (product_id, attribute_id) do nothing
  returning id, product_id, company_id, attribute_id
)
insert into backup_limpieza.reparar_atributos_20261126_valores (valor_id, product_id, company_id, attribute_id)
select id, product_id, company_id, attribute_id from nuevos
on conflict (valor_id) do nothing;

-- 4. Origen 'maestro' en lo añadido (solo si la migración 20261129110000 está aplicada).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_attribute_values' and column_name = 'origen'
  ) then
    execute $q$
      update public.product_attribute_values
         set origen = 'maestro'
       where origen is null
         and id in (select valor_id from backup_limpieza.reparar_atributos_20261126_valores)
    $q$;
  end if;
end $$;

-- Resumen por producto (para el informe).
select c.name as empresa,
       p.name as producto,
       cp.supplier_reference as ref_maestro,
       (select count(*) from public.catalog_product_attributes a where a.catalog_product_id = cp.id) as en_maestro,
       (select count(*) from public.product_attribute_values v where v.product_id = p.id) as en_empresa,
       (select count(*) from backup_limpieza.reparar_atributos_20261126_valores b where b.product_id = p.id) as anadidos
from public.products p
join public.companies c on c.id = p.company_id
join public.catalog_products cp on cp.id = p.catalog_product_id
where p.deleted_at is null
order by 1, 2;

commit;
