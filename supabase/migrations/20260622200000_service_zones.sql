-- =============================================================================
-- 20260622200000_service_zones.sql
-- Zonas de servicio por empresa para el motor híbrido de fechas ofrecibles:
--  · Cada zona mapea unos prefijos de código postal a unos días de la semana
--    en que la empresa cubre esa zona (ej. CP 15300-15319 -> martes y jueves).
--  · El motor combina la zona del CP del cliente con la disponibilidad real
--    del técnico (horario, festivos, capacidad) y la proximidad de ruta.
--
-- weekdays usa el MISMO criterio que user_work_schedules: 0=Lunes ... 6=Domingo.
--
-- RLS: igual que el resto de tablas de config (email_templates): solo policy
-- _super; todo el acceso real va por server actions con admin client +
-- filtrado por company_id + guard de rol.
-- =============================================================================

create table if not exists public.service_zones (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  postal_prefixes text[] not null default '{}',   -- prefijos o CP completos, ej {"15300","1503"}
  weekdays        smallint[] not null default '{}', -- 0=Lun ... 6=Dom
  active          boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_service_zones_company
  on public.service_zones(company_id) where active;

create trigger trg_service_zones_updated
  before update on public.service_zones
  for each row execute function app.set_updated_at();

comment on table public.service_zones is
  'Zonas de servicio: mapean prefijos de CP a días de la semana cubiertos. Alimentan el motor de fechas ofrecibles al cliente.';
comment on column public.service_zones.weekdays is
  'Días cubiertos. 0=Lunes ... 6=Domingo (mismo criterio que user_work_schedules).';

alter table public.service_zones enable row level security;
drop policy if exists service_zones_super on public.service_zones;
create policy service_zones_super on public.service_zones
  for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

-- Ajustes del motor de disponibilidad (capacidad + ventana de oferta).
-- El radio de ruta (scheduling_max_route_radius_km) ya existe (20260615100000).
alter table public.company_settings
  add column if not exists scheduling_jobs_per_slot int not null default 2,
  add column if not exists scheduling_offer_weeks   int not null default 4;

comment on column public.company_settings.scheduling_jobs_per_slot is
  'Máximo de trabajos por técnico y franja (mañana/tarde) al ofrecer fechas al cliente.';
comment on column public.company_settings.scheduling_offer_weeks is
  'Cuántas semanas hacia delante se ofrecen al cliente al reagendar.';

notify pgrst, 'reload schema';
