-- =============================================================================
-- 20260501121900_parked_modules.sql
-- Capa 2 · Módulos APARCADOS — estructura BD mínima prevista.
--
-- Owner aplaza implementación a fases finales. Solo creamos las tablas raíz
-- para que cuando se implementen no haya migraciones masivas posteriores.
--
-- Módulos:
--   - points                  programa de puntos / comisiones
--   - time_tracking           fichajes y control horario
--   - savings_calculator      calculadora de ahorro (config)
--   - invoicing               facturación régimen común (decisión #5)
-- =============================================================================

-- =============================================================================
-- POINTS — programa de puntos
-- =============================================================================

create table public.points_rules (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  name                text not null,
  is_active           boolean not null default true,
  -- Aplicabilidad
  applies_to          text not null check (applies_to in ('product','category','plan_type','any')),
  product_id          uuid references public.products(id) on delete cascade,
  category_id         uuid references public.product_categories(id) on delete cascade,
  plan_type           app.pricing_plan_type,
  -- Cálculo
  points_fixed        integer,
  points_per_euro     numeric(8,4),
  -- Reparto (para origen TMK)
  tmk_split_percent   numeric(5,2) default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_pr_company on public.points_rules(company_id) where is_active = true;

create trigger trg_pr_updated
  before update on public.points_rules
  for each row execute function app.set_updated_at();

create table public.points_ledger (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  user_id                 uuid not null references auth.users(id) on delete cascade,
  points                  integer not null,                              -- positivos suman, negativos restan
  reason                  text not null,
  rule_id                 uuid references public.points_rules(id),
  -- Origen
  contract_id             uuid references public.contracts(id) on delete set null,
  sales_record_id         uuid references public.sales_records(id) on delete set null,
  installation_id         uuid references public.installations(id) on delete set null,
  -- Período
  period_year             integer not null,
  period_month            integer not null,
  awarded_at              timestamptz not null default now(),
  awarded_by              uuid references auth.users(id) on delete set null
);

create index idx_pl_user_period on public.points_ledger(user_id, period_year, period_month);
create index idx_pl_company_period on public.points_ledger(company_id, period_year, period_month);

-- =============================================================================
-- TIME TRACKING — fichajes
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'time_punch_kind') then
    create type app.time_punch_kind as enum ('clock_in','clock_out','break_start','break_end');
  end if;
end $$;

create table public.time_punches (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  punch_kind      app.time_punch_kind not null,
  punched_at      timestamptz not null default now(),
  geo_latitude    numeric(9,6),
  geo_longitude   numeric(9,6),
  device_info     text,
  is_manual       boolean not null default false,                       -- ajuste manual (admin)
  manual_reason   text,
  notes           text
);

create index idx_tp_user_at on public.time_punches(user_id, punched_at desc);
create index idx_tp_company_at on public.time_punches(company_id, punched_at desc);

create table public.time_absences (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  starts_on       date not null,
  ends_on         date not null,
  kind            text not null check (kind in ('vacation','sick','personal','training','other')),
  status          text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create index idx_ta_user on public.time_absences(user_id, starts_on);

-- =============================================================================
-- SAVINGS CALCULATOR — calculadora de ahorro
-- (Configuración por empresa. Lógica se afinará al implementar UI;
--  owner pidió comparar con ZIP cuando lleguemos al módulo.)
-- =============================================================================

create table public.savings_water_types (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,                                         -- "agua embotellada", "garrafa 8L", "fuente oficina"
  cost_per_liter_cents numeric(10,4),
  cost_per_unit_cents  integer,
  unit_volume_liters   numeric(10,2),
  notes               text,
  is_active           boolean not null default true,
  display_order       integer not null default 0
);

create index idx_swt_company on public.savings_water_types(company_id);

create table public.savings_consumption_profiles (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,                                         -- "Familia 4 personas", "Oficina 10 empleados"
  liters_per_person_per_day numeric(10,2),
  default_persons integer,
  notes           text,
  is_active       boolean not null default true,
  display_order   integer not null default 0
);

create table public.savings_recommended_products (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  consumption_profile_id uuid references public.savings_consumption_profiles(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  display_order   integer not null default 0,
  is_extra        boolean not null default false                         -- "extras" como grifos, enfriadores
);

create index idx_srp_company on public.savings_recommended_products(company_id);

-- =============================================================================
-- INVOICING — facturación régimen común
-- (Decisión #5: aparcado, no País Vasco. Estructura mínima.)
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'invoice_kind') then
    create type app.invoice_kind as enum ('proforma','invoice','credit_note','delivery_note');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'invoice_status') then
    create type app.invoice_status as enum ('draft','issued','paid','overdue','void','cancelled');
  end if;
end $$;

create table public.invoice_series (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  kind            app.invoice_kind not null,
  series_code     text not null,                                         -- "A", "B", "FR"...
  description     text,
  current_year    integer,
  next_number     integer not null default 1,
  resets_yearly   boolean not null default true,
  is_active       boolean not null default true,
  unique (company_id, kind, series_code)
);

create table public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  customer_id         uuid not null references public.customers(id) on delete restrict,
  contract_id         uuid references public.contracts(id) on delete set null,

  kind                app.invoice_kind not null,
  series_id           uuid not null references public.invoice_series(id),
  number              integer not null,
  fiscal_year         integer not null,
  full_reference      text not null,                                     -- "A-2026-00042"

  status              app.invoice_status not null default 'draft',

  -- Datos fiscales snapshot
  customer_fiscal_snapshot jsonb,
  company_fiscal_snapshot  jsonb,

  -- Totales
  subtotal_cents          integer not null default 0,
  tax_cents               integer not null default 0,
  total_cents             integer not null default 0,
  withholdings_cents      integer not null default 0,

  -- Fechas
  issue_date              date not null default current_date,
  due_date                date,
  paid_at                 timestamptz,

  -- Documento
  pdf_document_id         uuid references public.documents(id) on delete set null,

  -- Si es nota de crédito, a qué factura corrige
  corrects_invoice_id     uuid references public.invoices(id) on delete set null,

  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (company_id, series_id, fiscal_year, number)
);

create index idx_inv_company_status on public.invoices(company_id, status);
create index idx_inv_customer on public.invoices(company_id, customer_id);
create index idx_inv_period on public.invoices(company_id, fiscal_year, issue_date);

create trigger trg_inv_updated
  before update on public.invoices
  for each row execute function app.set_updated_at();

create table public.invoice_lines (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references public.invoices(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  product_id          uuid references public.products(id) on delete set null,
  description         text not null,
  quantity            numeric(10,3) not null default 1 check (quantity > 0),
  unit_price_cents    integer not null check (unit_price_cents >= 0),
  discount_percent    numeric(5,2) default 0,
  tax_rate_percent    numeric(5,2) not null default 21,
  tax_cents           integer not null default 0,
  subtotal_cents      integer not null default 0,
  total_cents         integer not null default 0,
  display_order       integer not null default 0
);

create index idx_il_invoice on public.invoice_lines(invoice_id);

-- =============================================================================
-- RLS — todas las aparcadas: solo admin manage; tenant select;
-- saving_calculator está en /configuracion/calculadora-ahorro
-- =============================================================================
do $$
declare t text;
begin
  for t in select unnest(array[
    'points_rules','points_ledger','time_punches','time_absences',
    'savings_water_types','savings_consumption_profiles','savings_recommended_products',
    'invoice_series','invoices','invoice_lines'
  ]::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_tenant', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = app.current_company_id())', t || '_select_tenant', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_manage', t);
    execute format('create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id() and app.has_role(''company_admin'')) with check (company_id = app.current_company_id() and app.has_role(''company_admin''))', t || '_admin_manage', t);
  end loop;
end $$;

-- time_punches: el propio usuario puede insertar SUS fichajes
drop policy if exists time_punches_user_insert on public.time_punches;
create policy time_punches_user_insert on public.time_punches
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and user_id = auth.uid()
    and is_manual = false
  );

drop policy if exists time_punches_user_select on public.time_punches;
create policy time_punches_user_select on public.time_punches
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (user_id = auth.uid() or app.has_role('company_admin'))
  );

-- points_ledger: el propio usuario ve los suyos
drop policy if exists points_ledger_user_select on public.points_ledger;
create policy points_ledger_user_select on public.points_ledger
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (
      user_id = auth.uid()
      or app.has_role('company_admin')
      or app.has_role('commercial_director')
      or app.has_role('telemarketing_director')
    )
  );
