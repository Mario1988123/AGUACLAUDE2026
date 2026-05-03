-- =============================================================================
-- 20260503320000_time_tracking.sql
-- Fichajes completos:
--   - geolocalización obligatoria (si NULL se marca needs_geo_review)
--   - horario laboral por usuario (user_work_schedules)
--   - saldo de vacaciones (user_vacation_balances)
--   - calendario laboral con festivos (holidays)
--   - autocierre de fichajes abiertos 2h tras fin de jornada
-- =============================================================================

-- 1) Endurecer time_punches con flags de geo
alter table public.time_punches
  add column if not exists needs_geo_review boolean not null default false,
  add column if not exists accuracy_meters  numeric(8,2),
  add column if not exists auto_closed      boolean not null default false,
  add column if not exists edited_by_admin  uuid references auth.users(id),
  add column if not exists edited_reason    text;

-- 2) Horarios laborales por usuario (uno por día de la semana)
create table if not exists public.user_work_schedules (
  user_id        uuid not null references auth.users(id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete cascade,
  day_of_week    smallint not null check (day_of_week between 0 and 6), -- 0=Lun ... 6=Dom
  starts_at      time,
  ends_at        time,
  break_minutes  integer not null default 0,
  expected_hours numeric(5,2),
  created_at     timestamptz not null default now(),
  primary key (user_id, day_of_week)
);
create index if not exists idx_work_schedule_company on public.user_work_schedules(company_id);

-- 3) Saldo de vacaciones por usuario y año
create table if not exists public.user_vacation_balances (
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  year        integer not null,
  days_total  integer not null default 22,
  days_taken  integer not null default 0,
  notes       text,
  primary key (user_id, year)
);

-- 4) Calendario laboral / festivos
do $$ begin
  if not exists (select 1 from pg_type where typname = 'holiday_scope') then
    create type app.holiday_scope as enum ('national','region','company');
  end if;
end $$;

create table if not exists public.holidays (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade, -- null = nacional global
  scope       app.holiday_scope not null default 'company',
  region_code text,                                                    -- "ES-MD","ES-CT"...
  holiday_date date not null,
  name        text not null,
  is_workable boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (company_id, holiday_date, region_code)
);
create index if not exists idx_holidays_company_date on public.holidays(company_id, holiday_date);
create index if not exists idx_holidays_region on public.holidays(region_code, holiday_date);

-- 5) Provincia/región configurada por la empresa (para sugerir festivos)
alter table public.company_settings
  add column if not exists region_code text;

-- 6) Función para detectar fichajes abiertos +2h tras fin jornada y autocerrarlos
create or replace function app.autoclose_stale_punches() returns integer
language plpgsql
security definer
as $$
declare
  punch record;
  sched record;
  closed_at_iso timestamptz;
  total integer := 0;
begin
  for punch in
    select tp.id, tp.user_id, tp.company_id, tp.punched_at
      from public.time_punches tp
     where tp.punch_kind = 'clock_in'
       and not exists (
         select 1 from public.time_punches tp2
          where tp2.user_id = tp.user_id
            and tp2.punch_kind = 'clock_out'
            and tp2.punched_at > tp.punched_at
            and tp2.punched_at::date = tp.punched_at::date
       )
       and tp.punched_at < now() - interval '2 hours'
       and tp.punched_at::date < current_date
  loop
    -- Buscar horario del día correspondiente al clock_in
    select * into sched
      from public.user_work_schedules
     where user_id = punch.user_id
       and day_of_week = ((extract(isodow from punch.punched_at)::int - 1) % 7);
    if sched.ends_at is not null then
      closed_at_iso := (punch.punched_at::date + sched.ends_at)::timestamptz + interval '2 hours';
    else
      closed_at_iso := punch.punched_at + interval '8 hours'; -- fallback
    end if;

    insert into public.time_punches (
      company_id, user_id, punch_kind, punched_at, is_manual, manual_reason, auto_closed
    ) values (
      punch.company_id, punch.user_id, 'clock_out',
      closed_at_iso, true, 'Autocierre por olvido del clock_out', true
    );
    total := total + 1;
  end loop;
  return total;
end;
$$;

grant execute on function app.autoclose_stale_punches() to authenticated;

-- 7) RLS para nuevas tablas
alter table public.user_work_schedules enable row level security;
alter table public.user_vacation_balances enable row level security;
alter table public.holidays enable row level security;

drop policy if exists uws_super on public.user_work_schedules;
create policy uws_super on public.user_work_schedules
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists uws_select_tenant on public.user_work_schedules;
create policy uws_select_tenant on public.user_work_schedules
  for select to authenticated using (company_id = app.current_company_id());
drop policy if exists uws_admin_manage on public.user_work_schedules;
create policy uws_admin_manage on public.user_work_schedules
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

drop policy if exists uvb_super on public.user_vacation_balances;
create policy uvb_super on public.user_vacation_balances
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists uvb_select_tenant on public.user_vacation_balances;
create policy uvb_select_tenant on public.user_vacation_balances
  for select to authenticated using (company_id = app.current_company_id());
drop policy if exists uvb_admin_manage on public.user_vacation_balances;
create policy uvb_admin_manage on public.user_vacation_balances
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

drop policy if exists hol_super on public.holidays;
create policy hol_super on public.holidays
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists hol_select on public.holidays;
create policy hol_select on public.holidays
  for select to authenticated
  using (company_id is null or company_id = app.current_company_id());
drop policy if exists hol_admin_manage on public.holidays;
create policy hol_admin_manage on public.holidays
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

-- 8) Desaparcar el módulo time_tracking
update public.modules_catalog
   set is_parked = false
 where key = 'time_tracking';

-- 9) Seed festivos nacionales 2026 España (si no existen)
insert into public.holidays (company_id, scope, region_code, holiday_date, name)
values
  (null, 'national', 'ES', '2026-01-01', 'Año Nuevo'),
  (null, 'national', 'ES', '2026-01-06', 'Reyes'),
  (null, 'national', 'ES', '2026-04-03', 'Viernes Santo'),
  (null, 'national', 'ES', '2026-05-01', 'Día del Trabajo'),
  (null, 'national', 'ES', '2026-08-15', 'Asunción'),
  (null, 'national', 'ES', '2026-10-12', 'Fiesta Nacional'),
  (null, 'national', 'ES', '2026-11-02', 'Todos los Santos (trasladado)'),
  (null, 'national', 'ES', '2026-12-07', 'Día de la Constitución (trasladado)'),
  (null, 'national', 'ES', '2026-12-08', 'Inmaculada Concepción'),
  (null, 'national', 'ES', '2026-12-25', 'Navidad')
on conflict do nothing;
