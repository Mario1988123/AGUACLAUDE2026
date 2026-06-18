-- =============================================================================
-- Calculadora de ahorro: deduplicar marcas + restricción única
-- =============================================================================
-- Causa raíz del bug "marcas de supermercado repetidas":
--   seed_savings_calculator() se llama desde dos sitios (getSavingsConfig por
--   ausencia de config y listSavingsBrands por count==0). Ambas páginas las
--   invocan en el MISMO Promise.all, así que en una empresa nueva las dos
--   guardas pasan a la vez y la siembra corre dos veces. El `on conflict do
--   nothing` de la función NO protegía porque la tabla no tenía ninguna
--   restricción única → se insertaban 14 marcas (7 + 7) en vez de 7.
--
-- Esta migración:
--   1) Repunta las propuestas que apuntaban a una marca duplicada hacia la
--      marca que se conserva (no perdemos referencias).
--   2) Borra las filas duplicadas, conservando por (empresa, nombre, tipo) la
--      EDITADA MÁS RECIENTEMENTE (updated_at), para no perder ajustes de precio
--      que el admin hubiera hecho a mano. Empate → id menor (determinista).
--   3) Crea un índice único sobre (company_id, lower(trim(name)), kind) para
--      que `on conflict do nothing` de la siembra sea efectivo a partir de ahora.
-- Aditiva y reentrante: si no hay duplicados no borra nada.
-- =============================================================================

-- 1) Repuntar propuestas de la marca duplicada a la que se conserva
update public.savings_proposals sp
set current_brand_id = keep.keep_id
from (
  select
    b.id as dup_id,
    first_value(b.id) over (
      partition by b.company_id, lower(trim(b.name)), b.kind
      order by b.updated_at desc nulls last, b.id asc
    ) as keep_id
  from public.savings_water_brands b
) keep
where sp.current_brand_id = keep.dup_id
  and keep.dup_id <> keep.keep_id;

-- 2) Borrar las filas duplicadas (todas menos la que se conserva por grupo)
delete from public.savings_water_brands b
using (
  select id
  from (
    select
      id,
      row_number() over (
        partition by company_id, lower(trim(name)), kind
        order by updated_at desc nulls last, id asc
      ) as rn
    from public.savings_water_brands
  ) ranked
  where ranked.rn > 1
) dups
where b.id = dups.id;

-- 3) Restricción única para impedir nuevos duplicados
create unique index if not exists uq_swb_company_name_kind
  on public.savings_water_brands (company_id, lower(trim(name)), kind);

comment on index public.uq_swb_company_name_kind is
  'Impide marcas de agua duplicadas por empresa (mismo nombre+tipo). Hace efectivo el on conflict do nothing de seed_savings_calculator.';
