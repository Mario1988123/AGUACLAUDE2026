-- =============================================================================
-- 20260504130000_consolidated_pending.sql
--
-- MIGRACIÓN CONSOLIDADA — todo lo pendiente de aplicar en producción.
-- Idempotente: usa "if not exists" / "if exists" en todas las operaciones,
-- así que es seguro ejecutarla varias veces.
--
-- Bundle de:
--   - 20260503320000  time_tracking (geo + horario + festivos)
--   - 20260503340000  proposal_overhaul (chosen_plan_type, items config)
--   - 20260503350000  drop_proposal_variants
--   - 20260504100000  contract_install_pref_signatures
--   - 20260504110000  install_pref_days
--   - 20260504120000  install_pref_dates
-- =============================================================================


-- ======================================================================
-- 1) TIME TRACKING (fichaje)
-- ======================================================================

alter table public.time_punches
  add column if not exists needs_geo_review boolean not null default false,
  add column if not exists accuracy_meters  numeric(8,2),
  add column if not exists auto_closed      boolean not null default false,
  add column if not exists edited_by_admin  uuid references auth.users(id),
  add column if not exists edited_reason    text;

create table if not exists public.user_work_schedules (
  user_id        uuid not null references auth.users(id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete cascade,
  day_of_week    smallint not null check (day_of_week between 0 and 6),
  starts_at      time,
  ends_at        time,
  break_minutes  integer not null default 0,
  expected_hours numeric(5,2),
  created_at     timestamptz not null default now(),
  primary key (user_id, day_of_week)
);
create index if not exists idx_work_schedule_company on public.user_work_schedules(company_id);

create table if not exists public.user_vacation_balances (
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  year        integer not null,
  days_total  integer not null default 22,
  days_taken  integer not null default 0,
  notes       text,
  primary key (user_id, year)
);

do $$ begin
  if not exists (select 1 from pg_type where typname = 'holiday_scope') then
    create type app.holiday_scope as enum ('national','region','company');
  end if;
end $$;

create table if not exists public.holidays (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade,
  scope        app.holiday_scope not null default 'company',
  region_code  text,
  holiday_date date not null,
  name         text not null,
  is_workable  boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (company_id, holiday_date, region_code)
);
create index if not exists idx_holidays_company_date on public.holidays(company_id, holiday_date);
create index if not exists idx_holidays_region on public.holidays(region_code, holiday_date);

alter table public.company_settings
  add column if not exists region_code text;

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
    select * into sched
      from public.user_work_schedules
     where user_id = punch.user_id
       and day_of_week = ((extract(isodow from punch.punched_at)::int - 1) % 7);
    if sched.ends_at is not null then
      closed_at_iso := (punch.punched_at::date + sched.ends_at)::timestamptz + interval '2 hours';
    else
      closed_at_iso := punch.punched_at + interval '8 hours';
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

update public.modules_catalog
   set is_parked = false
 where key = 'time_tracking';

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


-- ======================================================================
-- 2) PROPOSAL OVERHAUL
-- ======================================================================

-- 'pending_approval' al enum proposal_status (si no existe)
do $$ begin
  begin
    alter type app.proposal_status add value if not exists 'pending_approval';
  exception when others then null;
  end;
end $$;

alter table public.proposals
  add column if not exists chosen_plan_type        app.pricing_plan_type,
  add column if not exists chosen_duration_months  integer,
  add column if not exists requires_approval       boolean not null default false,
  add column if not exists approved_by             uuid references auth.users(id),
  add column if not exists approved_at             timestamptz;

alter table public.proposal_items
  add column if not exists installation_included      boolean not null default true,
  add column if not exists installation_price_cents   integer,
  add column if not exists maintenance_included       boolean not null default false,
  add column if not exists maintenance_until_date     date,
  add column if not exists maintenance_price_cents    integer,
  add column if not exists maintenance_periodicity_months integer,
  add column if not exists deposit_cents              integer,
  add column if not exists charge_first_payment_now   boolean not null default false;

comment on column public.proposals.chosen_plan_type is
  'Plan único elegido para TODA la propuesta. Si el cliente quiere otro plan, se hace propuesta nueva.';
comment on column public.proposals.requires_approval is
  'true si alguna cuota/precio cae por debajo del mínimo autorizado.';
comment on column public.proposal_items.charge_first_payment_now is
  'Solo alquiler: si true, la 1ª cuota se cobra al firmar contrato y queda registrada en wallet.';


-- ======================================================================
-- 3) DROP proposal variants (feature retirada)
-- ======================================================================

alter table public.proposals
  drop column if exists variant_group_id,
  drop column if exists variant_label;


-- ======================================================================
-- 4) CONTRATOS — preferencia instalación + firmas data URL
-- ======================================================================

alter table public.contracts
  add column if not exists preferred_install_time_slot text
    check (preferred_install_time_slot in ('morning','afternoon','any','custom')),
  add column if not exists preferred_install_time_notes text;

comment on column public.contracts.preferred_install_time_slot is
  'Preferencia del cliente para la instalación: morning / afternoon / any / custom.';

-- contract_signatures: ahora la firma puede ser data URL (canvas)
do $$ begin
  begin
    alter table public.contract_signatures
      alter column signature_image_path drop not null;
  exception when others then null;
  end;
end $$;

alter table public.contract_signatures
  add column if not exists signature_data_url text;

comment on column public.contract_signatures.signature_data_url is
  'Data URL (base64 PNG) de la firma capturada en canvas.';


-- ======================================================================
-- 5) PREFERENCIA INSTALACIÓN — días de semana + día del mes (legacy)
-- ======================================================================

alter table public.contracts
  add column if not exists preferred_install_days_of_week int[]
    check (preferred_install_days_of_week is null
           or (array_length(preferred_install_days_of_week, 1) > 0
               and preferred_install_days_of_week <@ array[1,2,3,4,5,6,7]::int[])),
  add column if not exists preferred_install_day_of_month int
    check (preferred_install_day_of_month is null
           or preferred_install_day_of_month between 1 and 31);


-- ======================================================================
-- 6) PREFERENCIA INSTALACIÓN — fechas concretas (calendario multi-select)
-- ======================================================================

alter table public.contracts
  add column if not exists preferred_install_dates date[];

comment on column public.contracts.preferred_install_dates is
  'Fechas concretas preferidas por el cliente para la instalación. Carácter informativo.';


-- ======================================================================
-- FIN — recuerda recargar el schema cache si Supabase no detecta los
-- cambios automáticamente:
--   notify pgrst, 'reload schema';
-- ======================================================================
notify pgrst, 'reload schema';
