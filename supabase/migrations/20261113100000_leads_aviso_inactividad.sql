-- =============================================================================
-- Leads: aviso de inactividad configurable (plan docs/PLAN_REVISION_LEADS.md)
-- =============================================================================
-- Decisión de Mario (12-11): un lead parado NO se le quita al comercial; solo
-- se avisa (a él y un resumen al admin) pasados N días sin actividad, por
-- defecto 40. Aquí solo se añade el ajuste por empresa.
--
-- Aditiva e idempotente. El código funciona SIN ella: si la columna no
-- existe, el cron usa 40 días y /configuracion/leads muestra el ajuste
-- bloqueado. Las columnas lead_expiry_days* se dejan (ya no las usa nadie).
-- =============================================================================

alter table public.company_settings
  add column if not exists lead_stale_days integer not null default 40;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'company_settings_lead_stale_days_check'
       and conrelid = 'public.company_settings'::regclass
  ) then
    alter table public.company_settings
      add constraint company_settings_lead_stale_days_check
      check (lead_stale_days between 1 and 365);
  end if;
end $$;

comment on column public.company_settings.lead_stale_days is
  'Días sin actividad tras los que se AVISA del lead al comercial y al admin. No desasigna (decisión 2026-11-12).';

notify pgrst, 'reload schema';
