-- INFINITY AQUA: los valores del MAESTRO sustituyen a los propios (2026-11-27).
-- SIN APLICAR: lo revisa el coordinador y lo aplica Mario.
--
-- Encargo (respuesta 3 de Mario a §H de docs/DISENO_FICHAS_Y_PRODUCTOS.md):
--   «A Infinity se le ponen TODAS las características que vengan de Osmofilter.
--    En los productos enganchados al maestro, el valor del MAESTRO sustituye al
--    propio cuando difieren, con origen = 'maestro'. Los atributos propios que
--    choquen con uno del maestro («Voltaje 230» frente a «Alimentación
--    220-240V~50/60Hz») se ocultan (is_visible = false), no se borran.»
--
-- Comprobado con SELECT en producción el 26-11 (Management API, solo lectura):
--   * Hoy NINGÚN valor de Infinity difiere del maestro: los erróneos de Basic S
--     (FRO1046) están TAMBIÉN en el maestro. La carga de Osmofilter del 25-11
--     no pisó lo que ya había (informe scripts/catalogo-osmofilter/informes/
--     2026-11-25T16-28-38-529Z-aplicar.md: «FRO1046 · dispenser_cold_tank_l:
--     se queda 2 (Osmofilter: 3.5)»). Y «Voltaje 230» y «Frecuencia 55 Hz»
--     son del maestro antiguo; Osmofilter da «Alimentación 220-240V~50/60Hz».
--   * Por eso este script hace CUATRO cosas:
--       0. Corrige en el MAESTRO el depósito frío de FRO1046: 2 → 3,5 L (el
--          valor de Osmofilter). [decide del agente: sin esto el punto 1 no
--          cambia nada; si no se quiere tocar el maestro, borrar el paso 0].
--       1. Valores: el del maestro sustituye al propio cuando difieren
--          (origen = 'maestro').
--       2. Oculta (is_visible = false) los propios que chocan con uno del
--          maestro: Voltaje y Frecuencia frente a Alimentación eléctrica;
--          «3 vías» / «4 vías» propios frente a «Número de vías».
--       3. Medidas y peso del producto (products.dim_* y weight_grams) desde el
--          maestro cuando difieren. [decide del agente: Basic S tiene 10 g de
--          peso y fondo 410 frente a 15.800 g y 400 en el maestro; Mario pidió
--          «todas las características»].
--   * Idempotente: se puede lanzar dos veces; la segunda no cambia nada y la
--     copia conserva el valor ORIGINAL (on conflict do nothing).
--   * Todo lo cambiado queda en backup_limpieza.infinity_maestro_20261127_*.
--
-- VISTA PREVIA (solo lectura; lánzala antes que nada): la consulta marcada
-- «PRUEBA» al final del fichero, fuera de la transacción, lista lo que cambiaría.
--
-- DESHACER:
--   update public.catalog_product_attributes a set value_number = b.value_number
--     from backup_limpieza.infinity_maestro_20261127_catalogo b where b.id = a.id;
--   update public.product_attribute_values v
--      set value_text = b.value_text, value_number = b.value_number,
--          value_boolean = b.value_boolean, is_visible = b.is_visible, origen = b.origen
--     from backup_limpieza.infinity_maestro_20261127_valores b where b.valor_id = v.id;
--   update public.products p
--      set dim_width_mm = b.dim_width_mm, dim_height_mm = b.dim_height_mm,
--          dim_depth_mm = b.dim_depth_mm, weight_grams = b.weight_grams
--     from backup_limpieza.infinity_maestro_20261127_productos b where b.product_id = p.id;

begin;

create table if not exists backup_limpieza.infinity_maestro_20261127_catalogo (
  id uuid primary key,                 -- catalog_product_attributes.id
  catalog_product_id uuid not null,
  attribute_global_key text not null,
  value_number numeric,
  hecho_en timestamptz not null default now()
);
create table if not exists backup_limpieza.infinity_maestro_20261127_valores (
  valor_id uuid primary key,           -- product_attribute_values.id
  product_id uuid not null,
  attribute_id uuid not null,
  clave text not null,
  value_text text,
  value_number numeric,
  value_boolean boolean,
  is_visible boolean not null,
  origen text,
  accion text not null,                -- 'valor_maestro' | 'oculto'
  hecho_en timestamptz not null default now()
);
create table if not exists backup_limpieza.infinity_maestro_20261127_productos (
  product_id uuid primary key,
  dim_width_mm numeric,
  dim_height_mm numeric,
  dim_depth_mm numeric,
  weight_grams numeric,
  hecho_en timestamptz not null default now()
);

-- 0. MAESTRO: depósito frío de FRO1046 (Osmofilter: 3,5 L). ------------------
with objetivo as (
  select a.id, a.catalog_product_id, a.attribute_global_key, a.value_number
  from public.catalog_product_attributes a
  join public.catalog_products cp on cp.id = a.catalog_product_id
  where cp.supplier_reference = 'FRO1046'
    and a.attribute_global_key = 'dispenser_cold_tank_l'
    and a.value_number is distinct from 3.5
),
copia as (
  insert into backup_limpieza.infinity_maestro_20261127_catalogo (id, catalog_product_id, attribute_global_key, value_number)
  select id, catalog_product_id, attribute_global_key, value_number from objetivo
  on conflict (id) do nothing
  returning id
)
update public.catalog_product_attributes a
   set value_number = 3.5
  from objetivo o
 where a.id = o.id;

-- Valores de Infinity en productos enganchados, con su valor del maestro.
create temp table _infinity_vs_maestro on commit drop as
select v.id            as valor_id,
       v.product_id,
       v.attribute_id,
       coalesce(g.key, la.key) as clave,
       v.value_text, v.value_number, v.value_boolean, v.is_visible,
       ma.value_text   as m_text,
       ma.value_number as m_number,
       ma.value_boolean as m_boolean
from public.products p
join public.companies c on c.id = p.company_id
join public.product_attribute_values v on v.product_id = p.id
join public.product_attributes la on la.id = v.attribute_id
left join public.product_attributes_global g on g.id = la.cloned_from_global_id
join public.catalog_product_attributes ma
  on ma.catalog_product_id = p.catalog_product_id
 and ma.attribute_global_key = coalesce(g.key, la.key)
where c.id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'   -- INFINITY AQUA
  and p.deleted_at is null
  and p.catalog_product_id is not null
  and (ma.value_text is not null or ma.value_number is not null or ma.value_boolean is not null);

-- 1. El valor del maestro sustituye al propio cuando difieren. ---------------
insert into backup_limpieza.infinity_maestro_20261127_valores
  (valor_id, product_id, attribute_id, clave, value_text, value_number, value_boolean, is_visible, origen, accion)
select x.valor_id, x.product_id, x.attribute_id, x.clave, x.value_text, x.value_number, x.value_boolean,
       x.is_visible, v.origen, 'valor_maestro'
from _infinity_vs_maestro x
join public.product_attribute_values v on v.id = x.valor_id
where x.value_text is distinct from x.m_text
   or x.value_number is distinct from x.m_number
   or x.value_boolean is distinct from x.m_boolean
on conflict (valor_id) do nothing;

update public.product_attribute_values v
   set value_text    = x.m_text,
       value_number  = x.m_number,
       value_boolean = x.m_boolean,
       origen        = 'maestro'
  from _infinity_vs_maestro x
 where v.id = x.valor_id
   and (x.value_text is distinct from x.m_text
     or x.value_number is distinct from x.m_number
     or x.value_boolean is distinct from x.m_boolean);

-- 2. Ocultar los propios que chocan con uno del maestro. ----------------------
--    Solo si el mismo producto tiene VISIBLE el atributo del maestro que lo cubre.
create temp table _choques on commit drop as
select v.id as valor_id, v.product_id, v.attribute_id, la.key as clave,
       v.value_text, v.value_number, v.value_boolean, v.is_visible, v.origen
from public.products p
join public.product_attribute_values v on v.product_id = p.id
join public.product_attributes la on la.id = v.attribute_id
join (values
        ('^(dispenser|common)_voltage_v$',   'common_power_supply'),
        ('^(dispenser|common)_frequency_hz$', 'common_power_supply'),
        ('^[0-9]_vias$',                      'tap_ways')
     ) as regla(patron, clave_maestro) on la.key ~ regla.patron
where p.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
  and p.deleted_at is null
  and p.catalog_product_id is not null
  and v.is_visible
  and exists (
    select 1
    from public.product_attribute_values v2
    join public.product_attributes la2 on la2.id = v2.attribute_id
    left join public.product_attributes_global g2 on g2.id = la2.cloned_from_global_id
    where v2.product_id = p.id
      and v2.is_visible
      and coalesce(g2.key, la2.key) = regla.clave_maestro
  );

insert into backup_limpieza.infinity_maestro_20261127_valores
  (valor_id, product_id, attribute_id, clave, value_text, value_number, value_boolean, is_visible, origen, accion)
select valor_id, product_id, attribute_id, clave, value_text, value_number, value_boolean, is_visible, origen, 'oculto'
from _choques
on conflict (valor_id) do nothing;

update public.product_attribute_values v
   set is_visible = false
  from _choques c
 where v.id = c.valor_id;

-- 3. Medidas y peso desde el maestro cuando difieren. -------------------------
create temp table _medidas on commit drop as
select p.id as product_id,
       p.dim_width_mm, p.dim_height_mm, p.dim_depth_mm, p.weight_grams,
       nullif(cp.dim_width_mm, 0)  as m_ancho,
       nullif(cp.dim_height_mm, 0) as m_alto,
       nullif(cp.dim_depth_mm, 0)  as m_fondo,
       nullif(cp.weight_grams, 0)  as m_peso
from public.products p
join public.catalog_products cp on cp.id = p.catalog_product_id
where p.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c'
  and p.deleted_at is null
  and (   (cp.dim_width_mm  > 0 and p.dim_width_mm  is distinct from cp.dim_width_mm)
       or (cp.dim_height_mm > 0 and p.dim_height_mm is distinct from cp.dim_height_mm)
       or (cp.dim_depth_mm  > 0 and p.dim_depth_mm  is distinct from cp.dim_depth_mm)
       or (cp.weight_grams  > 0 and p.weight_grams  is distinct from cp.weight_grams));

insert into backup_limpieza.infinity_maestro_20261127_productos
  (product_id, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams)
select product_id, dim_width_mm, dim_height_mm, dim_depth_mm, weight_grams from _medidas
on conflict (product_id) do nothing;

update public.products p
   set dim_width_mm  = coalesce(m.m_ancho, p.dim_width_mm),
       dim_height_mm = coalesce(m.m_alto,  p.dim_height_mm),
       dim_depth_mm  = coalesce(m.m_fondo, p.dim_depth_mm),
       weight_grams  = coalesce(m.m_peso,  p.weight_grams)
  from _medidas m
 where p.id = m.product_id;

-- Resumen (para el informe).
select b.accion, p.name as producto, b.clave,
       coalesce(b.value_text, b.value_number::text, b.value_boolean::text) as antes,
       coalesce(v.value_text, v.value_number::text, v.value_boolean::text) as ahora,
       v.is_visible
from backup_limpieza.infinity_maestro_20261127_valores b
join public.product_attribute_values v on v.id = b.valor_id
join public.products p on p.id = b.product_id
order by p.name, b.accion, b.clave;

commit;

-- =============================================================================
-- PRUEBA (solo lectura; lánzala SOLA antes de aplicar): lo que cambiaría.
-- =============================================================================
-- with maestro as (
--   select a.catalog_product_id, a.attribute_global_key, a.value_text, a.value_boolean,
--          case when cp.supplier_reference = 'FRO1046' and a.attribute_global_key = 'dispenser_cold_tank_l'
--               then 3.5 else a.value_number end as value_number
--   from public.catalog_product_attributes a
--   join public.catalog_products cp on cp.id = a.catalog_product_id
-- )
-- select 'valor_maestro' as accion, p.name, coalesce(g.key, la.key) as clave,
--        coalesce(v.value_text, v.value_number::text, v.value_boolean::text) as propio,
--        coalesce(m.value_text, m.value_number::text, m.value_boolean::text) as maestro
-- from public.products p
-- join public.product_attribute_values v on v.product_id = p.id
-- join public.product_attributes la on la.id = v.attribute_id
-- left join public.product_attributes_global g on g.id = la.cloned_from_global_id
-- join maestro m on m.catalog_product_id = p.catalog_product_id and m.attribute_global_key = coalesce(g.key, la.key)
-- where p.company_id = 'f02d586c-0dc6-49e4-83e5-e0f6e688237c' and p.deleted_at is null
--   and (v.value_text is distinct from m.value_text or v.value_number is distinct from m.value_number
--        or v.value_boolean is distinct from m.value_boolean)
-- order by 2, 3;
