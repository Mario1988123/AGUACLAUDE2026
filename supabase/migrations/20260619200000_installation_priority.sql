-- ============================================================================
-- 20260619200000_installation_priority.sql
-- Añade priority a installations (decisión 2026-05-19).
-- Valores: low / normal / high / urgent. Default normal.
-- ============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'installation_priority') then
    create type app.installation_priority as enum ('low','normal','high','urgent');
  end if;
end $$;

alter table public.installations
  add column if not exists priority app.installation_priority not null default 'normal';

comment on column public.installations.priority is
  'Prioridad de la instalación. Default normal. Admin/director técnico pueden cambiarla desde la ficha.';

create index if not exists idx_installations_priority
  on public.installations(company_id, priority)
  where priority in ('high', 'urgent');
