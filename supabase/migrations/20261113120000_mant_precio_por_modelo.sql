-- =============================================================================
-- 20261113120000_mant_precio_por_modelo.sql
-- Precio del mantenimiento POR MODELO de equipo (petición de Mario 13-11).
--
-- Orden del precio de una visita que se cobra:
--   equipo > cliente > MODELO (producto del equipo; si es variante sin precio,
--   el de su gama) > empresa.
--
-- Base SIN IVA, en céntimos (mismo criterio que company_settings,
-- customers y customer_equipment en 20261113110000).
--
-- ADITIVA e IDEMPOTENTE. No toca datos.
-- NO APLICADA: la aplica Mario. Sin ella el panel de /configuracion/mantenimientos
-- no aparece y el precio se calcula como antes (equipo > cliente > empresa).
-- =============================================================================

alter table public.products add column if not exists mant_precio_filtros_cents integer;
alter table public.products add column if not exists mant_precio_filtros_membrana_cents integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_mant_precio_filtros_chk') then
    alter table public.products add constraint products_mant_precio_filtros_chk
      check (mant_precio_filtros_cents is null or mant_precio_filtros_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_mant_precio_filtros_membrana_chk') then
    alter table public.products add constraint products_mant_precio_filtros_membrana_chk
      check (mant_precio_filtros_membrana_cents is null or mant_precio_filtros_membrana_cents >= 0);
  end if;
end $$;

comment on column public.products.mant_precio_filtros_cents is
  'Precio (céntimos, SIN IVA) de la visita de mantenimiento «solo filtros» para equipos de este modelo, cuando ya no está incluida. Null = el de la gama (si es variante) o el de la empresa. El del equipo y el del cliente mandan sobre este.';
comment on column public.products.mant_precio_filtros_membrana_cents is
  'Precio (céntimos, SIN IVA) de la visita de mantenimiento «filtros + membrana» para equipos de este modelo, cuando ya no está incluida. Null = el de la gama (si es variante) o el de la empresa. El del equipo y el del cliente mandan sobre este.';

notify pgrst, 'reload schema';

-- Verificación:
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'products' and column_name like 'mant_precio_%';
