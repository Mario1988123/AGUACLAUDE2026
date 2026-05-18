-- =============================================================================
-- Sistema de error reports — los usuarios de empresas cliente reportan fallos
-- que llegan al panel del superadmin para diagnosticar y resolver.
-- =============================================================================

create table if not exists public.error_reports (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete set null,
  reported_by     uuid references auth.users(id) on delete set null,
  /** Ruta donde ocurrió (window.location.pathname). */
  route           text,
  /** Severidad escogida por el usuario o auto-asignada. */
  severity        text not null default 'medium'
    check (severity in ('low','medium','high','critical')),
  /** Resumen libre del usuario. */
  message         text not null,
  /** Pasos para reproducir, opcional. */
  steps_to_reproduce text,
  /** Captura técnica: user_agent, screen size, stack si hay error JS. */
  technical_payload jsonb not null default '{}'::jsonb,
  /** Estado del triaje. */
  status          text not null default 'new'
    check (status in ('new','triaged','in_progress','resolved','closed','wont_fix')),
  /** Asignado al superadmin que lo está mirando. */
  assigned_to     uuid references auth.users(id) on delete set null,
  /** Notas internas del superadmin (no visibles al cliente). */
  internal_notes  text,
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_err_status on public.error_reports(status, created_at desc);
create index if not exists idx_err_company on public.error_reports(company_id, created_at desc);
create index if not exists idx_err_severity on public.error_reports(severity)
  where status in ('new','triaged','in_progress');

create trigger trg_error_reports_updated
  before update on public.error_reports
  for each row execute function app.set_updated_at();

comment on table public.error_reports is
  'Reportes de fallo enviados por usuarios de empresas cliente. Visible '
  'solo en panel superadmin para diagnóstico cross-tenant.';

alter table public.error_reports enable row level security;

-- Superadmin todo
drop policy if exists err_super on public.error_reports;
create policy err_super on public.error_reports
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Tenant: cualquier usuario autenticado puede INSERT su reporte. NO puede
-- ver los reportes (esto es interno del superadmin).
drop policy if exists err_insert on public.error_reports;
create policy err_insert on public.error_reports
  for insert to authenticated
  with check (
    -- company_id debe ser la del usuario o NULL si no tiene empresa
    company_id = app.current_company_id() or company_id is null
  );

-- Tenant puede ver SOLO sus propios reportes (para hacer follow-up
-- desde un panel "mis reportes" si lo añadimos).
drop policy if exists err_select_own on public.error_reports;
create policy err_select_own on public.error_reports
  for select to authenticated
  using (reported_by = auth.uid());

notify pgrst, 'reload schema';
