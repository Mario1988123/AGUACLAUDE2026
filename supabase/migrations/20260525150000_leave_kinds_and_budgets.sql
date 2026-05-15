-- =============================================================================
-- 20260525150000_leave_kinds_and_budgets.sql
-- Ampliar tipos de ausencia + tabla de presupuesto por tipo y empleado.
--
-- Tipos previos: vacation, sick, personal, training, other (TEXT con CHECK).
-- Tipos nuevos: + paternity, maternity, marriage, bereavement, lactation,
--                parental_unpaid, mudanza, civic_duty
--
-- Tabla user_leave_budgets: contador por (user, year, kind). Permite al
-- admin definir el techo de días/semanas por empleado y tipo.
-- =============================================================================

-- Si time_absences.kind tiene CHECK con valores antiguos, ampliarlo.
-- (Es text, no enum, así que con DROP+ADD del check basta.)
do $$
declare
  cname text;
begin
  for cname in
    select conname from pg_constraint
     where conrelid = 'public.time_absences'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.time_absences drop constraint %I', cname);
  end loop;
end $$;

alter table public.time_absences
  add constraint time_absences_kind_check
  check (kind in (
    'vacation','sick','personal','training','other',
    'paternity','maternity','marriage','bereavement',
    'lactation','parental_unpaid','mudanza','civic_duty'
  ));

-- Tabla de presupuesto (techo) por usuario+año+tipo
create table if not exists public.user_leave_budgets (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  year          integer not null,
  kind          text not null check (kind in (
    'vacation','sick','personal','training','other',
    'paternity','maternity','marriage','bereavement',
    'lactation','parental_unpaid','mudanza','civic_duty'
  )),
  /** Unidad de presupuesto. Default 'days' (laborables). Para lactancia
   *  se podría usar 'hours' o 'months'. */
  unit          text not null default 'days' check (unit in ('days','hours','weeks','months')),
  budget        numeric(10,2) not null default 0,
  taken         numeric(10,2) not null default 0,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, user_id, year, kind)
);

create index if not exists idx_ulb_user_year
  on public.user_leave_budgets(user_id, year);
create index if not exists idx_ulb_company_year
  on public.user_leave_budgets(company_id, year);

create trigger trg_ulb_updated
  before update on public.user_leave_budgets
  for each row execute function app.set_updated_at();

comment on table public.user_leave_budgets is
  'Presupuesto y consumo por usuario, año y tipo de ausencia. Admin ajusta a mano.';

-- RLS
alter table public.user_leave_budgets enable row level security;

drop policy if exists ulb_super on public.user_leave_budgets;
create policy ulb_super on public.user_leave_budgets
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Empleado puede ver sus propios presupuestos
drop policy if exists ulb_self_select on public.user_leave_budgets;
create policy ulb_self_select on public.user_leave_budgets
  for select to authenticated
  using (user_id = auth.uid());

-- Admin/director gestionan
drop policy if exists ulb_admin_manage on public.user_leave_budgets;
create policy ulb_admin_manage on public.user_leave_budgets
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in (
           'company_admin','commercial_director','technical_director','telemarketing_director'
         )
         and ur.revoked_at is null
    )
  )
  with check (company_id = app.current_company_id());

-- Tabla de "días pendientes de clasificar" (Fase 7).
-- Si un empleado de nivel 2/3 con horario no fichó ningún día y no hay
-- ausencia justificada, el cron crea una fila aquí para que admin la
-- clasifique manualmente (vacaciones, baja, ausencia injustificada).
create table if not exists public.attendance_gaps (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  gap_date        date not null,
  status          text not null default 'pending'
                  check (status in ('pending','classified','dismissed')),
  /** Si admin lo clasifica como ausencia, kind queda aquí y se crea
   *  time_absences. Si lo descarta, classification_kind queda null. */
  classified_kind text,
  classified_by   uuid references auth.users(id) on delete set null,
  classified_at   timestamptz,
  classified_notes text,
  created_at      timestamptz not null default now(),
  unique (company_id, user_id, gap_date)
);

create index if not exists idx_ag_company_status
  on public.attendance_gaps(company_id, status, gap_date desc);

comment on table public.attendance_gaps is
  'Días sin fichaje de nivel 2/3 sin justificar. Admin clasifica como vacaciones, baja o ausencia injustificada.';

alter table public.attendance_gaps enable row level security;

drop policy if exists ag_super on public.attendance_gaps;
create policy ag_super on public.attendance_gaps
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists ag_self_select on public.attendance_gaps;
create policy ag_self_select on public.attendance_gaps
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists ag_admin_manage on public.attendance_gaps;
create policy ag_admin_manage on public.attendance_gaps
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in (
           'company_admin','commercial_director','technical_director','telemarketing_director'
         )
         and ur.revoked_at is null
    )
  )
  with check (company_id = app.current_company_id());

notify pgrst, 'reload schema';
