-- =============================================================================
-- 20260525120000_dedupe_holidays.sql
-- Festivos duplicados en /configuracion/festivos.
--
-- La unique constraint actual permite duplicar el mismo día si los
-- region_code son distintos (NULL vs 'ES' vs 'ES-MD'). Limpiamos
-- duplicados existentes y reforzamos con dos índices únicos parciales:
--   - uno para festivos globales (company_id IS NULL) por fecha + name
--   - otro para festivos de empresa (company_id NOT NULL) por fecha + name
-- =============================================================================

-- 1) Limpiar duplicados — quedarnos con el más antiguo de cada (date, name,
-- coalesce(company_id, '00000000-0000-0000-0000-000000000000'))
delete from public.holidays h
where exists (
  select 1
    from public.holidays h2
   where h2.holiday_date = h.holiday_date
     and coalesce(h2.name, '') = coalesce(h.name, '')
     and coalesce(h2.company_id::text, '') = coalesce(h.company_id::text, '')
     and h2.created_at < h.created_at
);

-- 2) Índice único endurecido para detectar duplicados aunque region_code
-- difiera. Dos índices parciales (Postgres trata NULL como distinto en
-- UNIQUE clásica, por eso usamos COALESCE en index expression).
drop index if exists ux_holidays_global;
create unique index ux_holidays_global
  on public.holidays(holiday_date, name)
  where company_id is null;

drop index if exists ux_holidays_company;
create unique index ux_holidays_company
  on public.holidays(company_id, holiday_date, name)
  where company_id is not null;

-- La unique constraint original (company_id, holiday_date, region_code)
-- la dejamos por si rompe migración legacy — los nuevos índices la
-- sustituyen efectivamente para prevenir duplicados visuales.

notify pgrst, 'reload schema';
