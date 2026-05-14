-- ============================================================================
-- Fase 2 objetivos segmentados por tipo de venta
-- ----------------------------------------------------------------------------
-- Decisión usuario 2026-05-13:
--   "Quiero objetivos por contado, renting y alquiler. Cada equipo cuenta
--    como un contrato. Acumulado total separado por tipo."
--
-- Mecanismo:
--   - Añadimos `plan_type` opcional a `monthly_objectives`. Si el objetivo
--     tiene plan_type=null → cuenta toda la actividad del mes (como hoy).
--     Si tiene plan_type='cash' / 'rental' / 'renting' → solo cuenta
--     ventas del tipo correspondiente desde sales_records.plan_type.
--   - Compatibilidad: el unique constraint actual no admite duplicar
--     (company, year, month, scope_type, scope_department, scope_user_id,
--      metric_kind). Ahora dos objetivos pueden coexistir con distinto
--     plan_type (p.ej. "Comerciales · contado · €" y "Comerciales · renting · €"),
--     así que extendemos el unique con plan_type.
-- ============================================================================

alter table public.monthly_objectives
  add column if not exists plan_type text
    check (plan_type is null or plan_type in ('cash', 'rental', 'renting'));

comment on column public.monthly_objectives.plan_type is
  'Segmenta el objetivo por tipo de venta. NULL = cualquiera (total). cash/rental/renting = solo ventas de ese plan_type en sales_records.';

-- Dropear el unique constraint anterior (si existe) y crear uno extendido.
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.monthly_objectives'::regclass
       and contype = 'u'
       and pg_get_constraintdef(oid) ilike '%scope_type%'
  loop
    execute format('alter table public.monthly_objectives drop constraint %I', c.conname);
  end loop;
end $$;

-- El nuevo unique incluye plan_type. coalesce no se puede usar en UNIQUE
-- directamente, así que añadimos índice único sobre la expresión.
create unique index if not exists ux_monthly_objectives_scope
  on public.monthly_objectives (
    company_id,
    period_year,
    period_month,
    scope_type,
    coalesce(scope_department::text, ''),
    coalesce(scope_user_id::text, ''),
    metric_kind,
    coalesce(plan_type, '')
  );

notify pgrst, 'reload schema';
