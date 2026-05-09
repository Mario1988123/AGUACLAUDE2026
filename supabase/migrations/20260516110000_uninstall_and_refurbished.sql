-- =============================================================================
-- Desinstalar equipo: nuevo kind 'uninstall' + estado 'refurbished'
-- =============================================================================
-- Decisión usuario 2026-05-09:
--  - Reutilizar tabla installations con kind='uninstall'.
--  - Estado del stock_unit_state nuevo: 'refurbished' (reacondicionado).
--    Las desinstalaciones devuelven al almacén destino (elegido por el
--    usuario, normalmente el de tipo 'used_equipment') con state='used',
--    y desde la ficha del almacén se puede pasar a 'refurbished'.
-- =============================================================================

-- 1) Añadir 'uninstall' al enum installation_kind
do $$ begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'installation_kind' and e.enumlabel = 'uninstall'
  ) then
    alter type app.installation_kind add value 'uninstall';
  end if;
end $$;

-- 2) Añadir 'refurbished' al enum stock_unit_state
do $$ begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'stock_unit_state' and e.enumlabel = 'refurbished'
  ) then
    alter type app.stock_unit_state add value 'refurbished';
  end if;
end $$;

-- 3) Marcador opcional en warehouses para identificar el almacén "por
-- defecto" de equipos usados (sugerencia, no obligatorio — el usuario
-- siempre puede elegir destino al desinstalar).
alter table public.warehouses
  add column if not exists is_used_equipment_default boolean not null default false;

create unique index if not exists idx_warehouses_one_used_default
  on public.warehouses(company_id) where is_used_equipment_default = true;

comment on column public.warehouses.is_used_equipment_default is
  'Si true, el sistema lo sugiere por defecto como destino al desinstalar equipos. Solo uno por empresa.';

notify pgrst, 'reload schema';
