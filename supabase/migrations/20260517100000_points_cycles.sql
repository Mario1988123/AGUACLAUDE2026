-- =============================================================================
-- 20260517100000_points_cycles.sql
-- Ciclos de cierre de comisiones (puntos→€).
-- Las comisiones son INFORMATIVAS, no se contabilizan ni generan asientos.
-- El ciclo solo permite a un director comercial / admin "cerrar" el periodo
-- y exportar el total a nómina manualmente.
-- =============================================================================

-- Cabecera del ciclo. Cada ciclo es un rango [start_at, end_at) por empresa.
-- Status:
--   'open'           — el periodo aún no ha terminado (sigue acumulando)
--   'pending_review' — el rango cerró, esperando aprobación del director
--   'closed'         — aprobado y bloqueado (no se admiten ajustes nuevos)
create table if not exists public.points_cycles (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  /** Año del ciclo. Para ciclo natural = año del mes; para ciclo día-X = año del mes de cierre */
  cycle_year      integer not null,
  /** Mes del ciclo (1-12). Mismo criterio que cycle_year */
  cycle_month     integer not null,
  /** Rango exacto en timestamptz [start_at, end_at) */
  cycle_start_at  timestamptz not null,
  cycle_end_at    timestamptz not null,
  /** Día del mes con el que se generó (snapshot del setting al crearse) */
  close_day       integer not null default 0,
  status          text not null default 'open' check (status in ('open','pending_review','closed')),
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id) on delete set null,
  /** Total de puntos del ciclo a fecha de cierre (snapshot, suma ledger + ajustes) */
  total_points    integer not null default 0,
  /** Total en € a fecha de cierre (snapshot, points × euros_per_point al cerrar) */
  total_cents     integer not null default 0,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (company_id, cycle_year, cycle_month)
);

create index if not exists idx_points_cycles_company_status
  on public.points_cycles(company_id, status, cycle_year desc, cycle_month desc);

-- Ajustes manuales sobre líneas del ledger dentro de un ciclo abierto.
-- Cada ajuste es un delta (positivo o negativo) sobre el ledger original
-- de un usuario. Append-only: un ajuste anterior se "deshace" creando otro
-- con el delta inverso, NUNCA borrando.
create table if not exists public.points_cycle_adjustments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  cycle_id        uuid not null references public.points_cycles(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  /** Línea del ledger a la que se aplica (NULL = ajuste libre del periodo) */
  ledger_entry_id uuid references public.points_ledger(id) on delete set null,
  /** Delta de puntos. Positivo suma, negativo resta */
  delta_points    integer not null,
  reason          text not null,
  adjusted_by     uuid not null references auth.users(id) on delete restrict,
  adjusted_at     timestamptz not null default now()
);

create index if not exists idx_pca_cycle_user
  on public.points_cycle_adjustments(cycle_id, user_id);
create index if not exists idx_pca_company
  on public.points_cycle_adjustments(company_id, adjusted_at desc);

-- RLS
alter table public.points_cycles enable row level security;
alter table public.points_cycle_adjustments enable row level security;

drop policy if exists points_cycles_company_select on public.points_cycles;
create policy points_cycles_company_select on public.points_cycles
  for select to authenticated
  using (company_id = (select company_id from public.user_profiles where user_id = auth.uid()));

drop policy if exists points_cycles_admin_write on public.points_cycles;
create policy points_cycles_admin_write on public.points_cycles
  for all to authenticated
  using (true) with check (true);

drop policy if exists pca_company_select on public.points_cycle_adjustments;
create policy pca_company_select on public.points_cycle_adjustments
  for select to authenticated
  using (company_id = (select company_id from public.user_profiles where user_id = auth.uid()));

drop policy if exists pca_admin_write on public.points_cycle_adjustments;
create policy pca_admin_write on public.points_cycle_adjustments
  for all to authenticated
  using (true) with check (true);

comment on table public.points_cycles is
  'Ciclos de cierre de comisiones (puntos → €). Solo informativos: cerrar un ciclo no genera asientos contables, solo bloquea ajustes y registra snapshot del total a llevar a nómina manualmente.';

comment on table public.points_cycle_adjustments is
  'Append-only. Ajustes manuales sobre puntos de un usuario en un ciclo. Para "deshacer" un ajuste se crea otro con delta inverso.';

notify pgrst, 'reload schema';
