-- Filtros de las gamas de fuente de INFINITY AQUA deducidos del catálogo maestro
-- (2026-11-25). SIN APLICAR: lo revisa el coordinador y se lo enseña a Mario.
-- Informe con el origen de cada asignación: docs/FILTROS_FUENTES_INFINITY_2026-11-26.md
--
-- Solo entra lo que tiene seguridad ALTA: gamas de Infinity enlazadas al maestro
-- (products.catalog_product_id, puesto en julio de 2026) cuyo equipo del maestro
-- trae sus consumibles en catalog_product_compatibilities:
--   · Infinity Basic S (Compact) → maestro FRO1046 «DISPENSADOR BLUE MOUNTAIN»
--   · Infinity Indic             → maestro FRO1093 «DISPENSADOR INDIC»
-- Las variantes (COMPACT, FIORD S, 630…, Infinity 1300, FIORD PLUS…) no tienen
-- filtros propios y heredan los de su gama (filtros_efectivos).
--
-- Qué hace (idempotente: se puede lanzar dos veces sin duplicar nada):
--  1. Crea en product_filters de Infinity los 6 consumibles del maestro que no
--     tiene (por internal_reference = referencia Osmofilter). Si ya existe uno con
--     esa referencia, lo reutiliza.
--  2. Asigna a cada gama sus 5 consumibles (4 filtros + 1 membrana), con
--     quantity_per_change = 1 (el maestro no trae cantidad) y SIN periodo de
--     cambio (el maestro no lo trae; no se inventa).
-- No toca stock, ni equipos, ni otras empresas.

begin;

-- 0. Guardas: si algo no está como se comprobó el 25-11, no se hace nada.
do $$
declare
  v_company constant uuid := 'f02d586c-0dc6-49e4-83e5-e0f6e688237c';
begin
  if not exists (select 1 from public.products where id = '4a44b563-9443-4678-ac73-1cac9c90baad'
                   and company_id = v_company and catalog_product_id = '171a4d33-ba66-406d-b63d-7e695cdea551'
                   and deleted_at is null) then
    raise exception 'Infinity Basic S (Compact) ya no está enlazada a FRO1046: revisar antes de aplicar';
  end if;
  if not exists (select 1 from public.products where id = 'c64e6cc1-49ec-4175-80bb-52d125b5d06d'
                   and company_id = v_company and catalog_product_id = '6ac988a3-eb83-40f8-9144-6dfa7c89f2d4'
                   and deleted_at is null) then
    raise exception 'Infinity Indic ya no está enlazada a FRO1093: revisar antes de aplicar';
  end if;
  if (select count(*) from public.catalog_products where id in (
        'e4ed20ba-2786-4f1c-8e80-6f609816347c','78d456f5-01a2-431b-a7c3-3c44f214788f',
        '48f462e3-c2f1-4ec7-9b9d-10931f891445','ada1057a-609b-484e-b17d-cbc1e434e4bf',
        '933e69fe-98d2-4dfd-b055-f83be4fa3953','bc44b627-05dc-4ffc-8048-456dddea18b3')) <> 6 then
    raise exception 'Faltan consumibles en el catálogo maestro';
  end if;
end $$;

-- 1. Filtros de Infinity desde el maestro (nombre y referencia del maestro).
with maestro(catalog_id, filter_type) as (
  values
    ('48f462e3-c2f1-4ec7-9b9d-10931f891445'::uuid, 'sediment'::app.product_filter_type),   -- FCS-24 PP
    ('e4ed20ba-2786-4f1c-8e80-6f609816347c'::uuid, 'gac'::app.product_filter_type),        -- FCC-22 GAC
    ('78d456f5-01a2-431b-a7c3-3c44f214788f'::uuid, 'cto'::app.product_filter_type),        -- FCC-23 CTO
    ('ada1057a-609b-484e-b17d-cbc1e434e4bf'::uuid, 'postcarbon'::app.product_filter_type), -- FP1023 postfiltro
    ('933e69fe-98d2-4dfd-b055-f83be4fa3953'::uuid, 'membrane'::app.product_filter_type),   -- RO4145 100 GPD
    ('bc44b627-05dc-4ffc-8048-456dddea18b3'::uuid, 'membrane'::app.product_filter_type)    -- RO4171 150 GPD
)
insert into public.product_filters (company_id, name, internal_reference, supplier_reference, manufacturer_name, filter_type, notes)
select 'f02d586c-0dc6-49e4-83e5-e0f6e688237c', cp.name, cp.supplier_reference, cp.supplier_reference, 'Osmofilter', m.filter_type,
       'Creado desde el catálogo maestro (catalog_products ' || cp.id || ') el 2026-11-26'
  from maestro m
  join public.catalog_products cp on cp.id = m.catalog_id
 where not exists (
   select 1 from public.product_filters f
    where f.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
      and f.deleted_at is null
      and upper(f.internal_reference) = upper(cp.supplier_reference)
 );

-- 2. Asignaciones gama → filtro, en el orden del maestro (display_order + 1).
with asignar(product_id, ref, etapa) as (
  values
    -- Infinity Basic S (Compact) ← FRO1046
    ('4a44b563-9443-4678-ac73-1cac9c90baad'::uuid, 'FCC-22', 1),
    ('4a44b563-9443-4678-ac73-1cac9c90baad'::uuid, 'FCC-23', 2),
    ('4a44b563-9443-4678-ac73-1cac9c90baad'::uuid, 'FCS-24', 3),
    ('4a44b563-9443-4678-ac73-1cac9c90baad'::uuid, 'FP1023', 4),
    ('4a44b563-9443-4678-ac73-1cac9c90baad'::uuid, 'RO4145', 5),
    -- Infinity Indic ← FRO1093
    ('c64e6cc1-49ec-4175-80bb-52d125b5d06d'::uuid, 'FCC-22', 1),
    ('c64e6cc1-49ec-4175-80bb-52d125b5d06d'::uuid, 'FCC-23', 2),
    ('c64e6cc1-49ec-4175-80bb-52d125b5d06d'::uuid, 'FCS-24', 3),
    ('c64e6cc1-49ec-4175-80bb-52d125b5d06d'::uuid, 'FP1023', 4),
    ('c64e6cc1-49ec-4175-80bb-52d125b5d06d'::uuid, 'RO4171', 5)
)
insert into public.product_filter_assignments
  (company_id, product_id, filter_id, stage_position, replacement_period_months, is_required, quantity_per_change, notes)
select 'f02d586c-0dc6-49e4-83e5-e0f6e688237c', a.product_id, f.id, a.etapa, null, true, 1,
       'Del catálogo maestro (compatibilidades del equipo enlazado), 2026-11-26'
  from asignar a
  join lateral (
    select f.id from public.product_filters f
     where f.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
       and f.deleted_at is null
       and upper(f.internal_reference) = upper(a.ref)
     order by f.created_at
     limit 1
  ) f on true
 where not exists (
   select 1 from public.product_filter_assignments x
    where x.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
      and x.product_id = a.product_id
      and x.filter_id = f.id
 );

-- Comprobación (dentro de la transacción): 5 asignaciones por gama.
do $$
begin
  if (select count(*) from public.product_filter_assignments
       where company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
         and product_id in ('4a44b563-9443-4678-ac73-1cac9c90baad','c64e6cc1-49ec-4175-80bb-52d125b5d06d')) <> 10 then
    raise exception 'No salen 10 asignaciones (5 por gama): se deshace todo';
  end if;
end $$;

commit;

-- Después de aplicar:
--   select p.name, f.internal_reference, f.filter_type, a.stage_position
--     from product_filter_assignments a
--     join products p on p.id = a.product_id
--     join product_filters f on f.id = a.filter_id
--    where a.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
--      and p.id in ('4a44b563-9443-4678-ac73-1cac9c90baad','c64e6cc1-49ec-4175-80bb-52d125b5d06d')
--    order by 1, 4;   -- 10 filas
