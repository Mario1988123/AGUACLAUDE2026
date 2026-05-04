-- =============================================================================
-- 20260504150000_installation_wizard.sql
-- Soporte para el wizard de instalación:
--   - installations.satisfaction_score (1-5 caritas, anónimo para instalador)
--   - installations.satisfaction_comment (texto opcional del cliente)
--   - installations.geo_lat/lng al iniciar parte (verificación 300m)
--   - installation_pauses (pausas con motivo, reanudación, fin de jornada)
--   - installation_incidents (incidencias durante la instalación)
-- =============================================================================

alter table public.installations
  add column if not exists satisfaction_score   smallint
    check (satisfaction_score is null or satisfaction_score between 1 and 5),
  add column if not exists satisfaction_comment text,
  add column if not exists started_geo_lat      numeric(9,6),
  add column if not exists started_geo_lng      numeric(9,6),
  add column if not exists started_far_from_address boolean not null default false;

comment on column public.installations.satisfaction_score is
  'Encuesta cliente al firmar: 1=😡 ... 5=😄. Anónimo para el instalador.';
comment on column public.installations.started_far_from_address is
  'true si al iniciar parte el GPS estaba a >300m de la dirección — dispara aviso a nivel 1/2.';

create table if not exists public.installation_pauses (
  id                  uuid primary key default gen_random_uuid(),
  installation_id     uuid not null references public.installations(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  reason              text not null check (reason in ('lunch','to_warehouse','to_buy','end_of_day','other')),
  reason_notes        text,
  paused_at           timestamptz not null default now(),
  resumed_at          timestamptz,
  scheduled_resume_at timestamptz,
  paused_by_user_id   uuid references auth.users(id),
  created_at          timestamptz not null default now()
);
create index if not exists idx_install_pauses_install on public.installation_pauses(installation_id);

alter table public.installation_pauses enable row level security;
drop policy if exists ip_super on public.installation_pauses;
create policy ip_super on public.installation_pauses
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists ip_tenant on public.installation_pauses;
create policy ip_tenant on public.installation_pauses
  for all to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());

create table if not exists public.installation_incidents (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  kind            text not null check (kind in ('missing_material','wrong_equipment','broken_equipment','customer_issue','other')),
  description     text,
  reported_by     uuid references auth.users(id),
  reported_at     timestamptz not null default now(),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_install_incidents_install on public.installation_incidents(installation_id);

alter table public.installation_incidents enable row level security;
drop policy if exists ii_super on public.installation_incidents;
create policy ii_super on public.installation_incidents
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists ii_tenant on public.installation_incidents;
create policy ii_tenant on public.installation_incidents
  for all to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());

notify pgrst, 'reload schema';
