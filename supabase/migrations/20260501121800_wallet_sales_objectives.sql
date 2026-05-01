-- =============================================================================
-- 20260501121800_wallet_sales_objectives.sql
-- Capa 2 · Wallet, price_approvals, sales_records, monthly_objectives, lost_sales.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'wallet_entry_status') then
    create type app.wallet_entry_status as enum (
      'pending','collected','pending_settlement','settled','validated','rejected'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'price_approval_status') then
    create type app.price_approval_status as enum (
      'pending','approved','rejected','cancelled'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'lost_sale_origin') then
    create type app.lost_sale_origin as enum ('lead_lost','free_trial_rejected','free_trial_removed');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'objective_scope_type') then
    create type app.objective_scope_type as enum ('department','user');
  end if;
end $$;

-- =============================================================================
-- wallet_entries
-- =============================================================================
create table public.wallet_entries (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,

  -- Origen
  contract_id             uuid references public.contracts(id) on delete restrict,
  contract_payment_id     uuid references public.contract_payments(id) on delete set null,
  installation_id         uuid references public.installations(id) on delete set null,
  customer_id             uuid references public.customers(id) on delete set null,

  -- Detalles
  concept                 text not null,
  amount_cents            integer not null check (amount_cents >= 0),
  method                  app.payment_method not null,
  status                  app.wallet_entry_status not null default 'pending',

  -- Quién cobra
  collected_by_user_id    uuid references auth.users(id),
  collected_at            timestamptz,

  -- Liquidación
  settled_at              timestamptz,
  settled_to_settlement_id uuid,                                          -- agrupación opcional

  -- Validación
  validated_by_user_id    uuid references auth.users(id),
  validated_at            timestamptz,
  rejected_reason         text,

  -- Justificante
  receipt_document_id     uuid references public.documents(id) on delete set null,

  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index idx_we_company_status on public.wallet_entries(company_id, status);
create index idx_we_collector on public.wallet_entries(company_id, collected_by_user_id, status) where collected_by_user_id is not null;
create index idx_we_contract on public.wallet_entries(contract_id) where contract_id is not null;

create trigger trg_we_updated
  before update on public.wallet_entries
  for each row execute function app.set_updated_at();

create trigger trg_we_audit
  after insert or update or delete on public.wallet_entries
  for each row execute function app.audit_trigger();

-- Cerrar FK forward de contract_payments
alter table public.contract_payments
  add constraint cp_wallet_entry_fk
  foreign key (wallet_entry_id) references public.wallet_entries(id) on delete set null;

-- =============================================================================
-- price_approvals
-- =============================================================================
create table public.price_approvals (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  -- Solicitante
  requested_by_user_id    uuid not null references auth.users(id) on delete restrict,
  requested_at            timestamptz not null default now(),
  -- Contexto: una propuesta o item dentro
  proposal_id             uuid references public.proposals(id) on delete cascade,
  proposal_payment_option_id uuid references public.proposal_payment_options(id) on delete cascade,
  product_id              uuid references public.products(id),
  pricing_plan_id         uuid references public.product_pricing_plans(id),
  -- Importes
  requested_price_cents   integer not null check (requested_price_cents >= 0),
  min_authorized_cents    integer not null,
  absolute_min_cents      integer not null,
  -- Decisión
  status                  app.price_approval_status not null default 'pending',
  decided_by_user_id      uuid references auth.users(id),
  decided_at              timestamptz,
  decision_note           text,
  -- Auditoría
  created_at              timestamptz not null default now()
);

create index idx_pa_company_status on public.price_approvals(company_id, status);
create index idx_pa_requested_by on public.price_approvals(requested_by_user_id, status);

create trigger trg_pa_audit
  after insert or update or delete on public.price_approvals
  for each row execute function app.audit_trigger();

-- Cerrar FK forward de proposal_payment_options
alter table public.proposal_payment_options
  add constraint ppo_price_approval_fk
  foreign key (price_approval_id) references public.price_approvals(id) on delete set null;

-- =============================================================================
-- sales_records (acumulado de ventas para ranking/dashboard)
-- =============================================================================
create table public.sales_records (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  contract_id             uuid not null references public.contracts(id) on delete cascade,
  contract_item_id        uuid references public.contract_items(id) on delete set null,
  -- Quién y cuándo
  sales_user_id           uuid references auth.users(id),                 -- comercial
  tmk_user_id             uuid references auth.users(id),                 -- TMK que generó (si aplica)
  installer_user_id       uuid references auth.users(id),                 -- instalador
  recorded_at             timestamptz not null default now(),
  -- Tipo de venta y montos
  plan_type               app.pricing_plan_type not null,
  total_cents             integer not null,                               -- monto total (contado o suma cuotas)
  monthly_cents           integer,
  duration_months         integer,
  financier_payment_cents integer,                                        -- lo que paga la financiera (renting)
  -- Comisión calculada (si aplica)
  commission_total_cents  integer,
  commission_split        jsonb default '{}'::jsonb,                      -- ej. {"sales_rep": 6000, "tmk": 2000}
  -- Período (para queries rápidas)
  period_year             integer not null,
  period_month            integer not null check (period_month between 1 and 12),
  notes                   text
);

create index idx_sr_company_period on public.sales_records(company_id, period_year, period_month);
create index idx_sr_sales_user on public.sales_records(company_id, sales_user_id, period_year, period_month);
create index idx_sr_tmk_user on public.sales_records(company_id, tmk_user_id, period_year, period_month) where tmk_user_id is not null;
create index idx_sr_contract on public.sales_records(contract_id);

-- =============================================================================
-- monthly_objectives (decisión D — cascada nivel 1 -> nivel 2)
-- =============================================================================
create table public.monthly_objectives (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  period_year         integer not null,
  period_month        integer not null check (period_month between 1 and 12),
  scope_type          app.objective_scope_type not null,
  scope_department    app.department_kind,                               -- si scope_type='department'
  scope_user_id       uuid references auth.users(id) on delete cascade,  -- si scope_type='user'
  -- Padre (para cascada): objetivo de departamento del que se distribuye
  parent_objective_id uuid references public.monthly_objectives(id) on delete cascade,
  -- Metas
  target_amount_cents integer,                                            -- € de venta
  target_units        integer,                                            -- nº contratos / instalaciones
  metric_kind         text not null default 'sales' check (metric_kind in ('sales','contracts','installations','recoveries')),
  -- Quién la fijó
  set_by_user_id      uuid references auth.users(id),
  -- Auditoría
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  check (
    (scope_type = 'department' and scope_department is not null and scope_user_id is null)
    or (scope_type = 'user' and scope_user_id is not null and scope_department is null)
  ),
  unique (company_id, period_year, period_month, scope_type, scope_department, scope_user_id, metric_kind)
);

create index idx_mo_company_period on public.monthly_objectives(company_id, period_year, period_month);
create index idx_mo_user on public.monthly_objectives(scope_user_id) where scope_user_id is not null;
create index idx_mo_dept on public.monthly_objectives(company_id, scope_department, period_year, period_month) where scope_department is not null;

create trigger trg_mo_updated
  before update on public.monthly_objectives
  for each row execute function app.set_updated_at();

-- =============================================================================
-- lost_sales
-- =============================================================================
create table public.lost_sales (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  origin              app.lost_sale_origin not null,
  -- Origen
  lead_id             uuid references public.leads(id) on delete set null,
  free_trial_id       uuid references public.free_trials(id) on delete set null,
  -- Datos
  reason              text,
  reason_category     text,                                                -- "precio","competencia","desinterés","otros"
  product_id          uuid references public.products(id) on delete set null,
  amount_cents        integer,                                              -- importe estimado perdido
  -- Recuperación
  assigned_recovery_user_id uuid references auth.users(id) on delete set null,
  recovery_assigned_at      timestamptz,
  recovery_attempted_at     timestamptz,
  is_recovered              boolean not null default false,
  recovered_at              timestamptz,
  recovered_to_lead_id      uuid references public.leads(id) on delete set null,
  -- Auditoría
  created_at                timestamptz not null default now(),
  created_by                uuid references auth.users(id),
  updated_at                timestamptz not null default now()
);

create index idx_ls_company on public.lost_sales(company_id);
create index idx_ls_recovery on public.lost_sales(assigned_recovery_user_id) where assigned_recovery_user_id is not null and is_recovered = false;

create trigger trg_ls_updated
  before update on public.lost_sales
  for each row execute function app.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
-- wallet_entries
alter table public.wallet_entries enable row level security;
alter table public.wallet_entries force row level security;
drop policy if exists we_super on public.wallet_entries;
create policy we_super on public.wallet_entries for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists we_select_by_scope on public.wallet_entries;
create policy we_select_by_scope on public.wallet_entries for select to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.can('wallet','view','all_company')
      or (app.can('wallet','view','department') and app.in_department('sales'))
      or (app.can('wallet','view','own') and collected_by_user_id = auth.uid())
    )
  );
drop policy if exists we_insert on public.wallet_entries;
create policy we_insert on public.wallet_entries for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and (
      app.can('wallet','create','all_company')
      or app.can('wallet','create','own')
    )
  );
drop policy if exists we_update on public.wallet_entries;
create policy we_update on public.wallet_entries for update to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.can('wallet','update','all_company')
      or app.can('wallet','approve','department')
      or (app.can('wallet','update','own') and collected_by_user_id = auth.uid())
    )
  )
  with check (company_id = app.current_company_id());

-- price_approvals
alter table public.price_approvals enable row level security;
alter table public.price_approvals force row level security;
drop policy if exists pa_super on public.price_approvals;
create policy pa_super on public.price_approvals for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists pa_select on public.price_approvals;
create policy pa_select on public.price_approvals for select to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.has_role('company_admin')
      or app.has_role('commercial_director')
      or requested_by_user_id = auth.uid()
    )
  );
drop policy if exists pa_insert on public.price_approvals;
create policy pa_insert on public.price_approvals for insert to authenticated
  with check (company_id = app.current_company_id() and requested_by_user_id = auth.uid());
drop policy if exists pa_decide on public.price_approvals;
create policy pa_decide on public.price_approvals for update to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin') or app.has_role('commercial_director'))
  )
  with check (company_id = app.current_company_id());

-- sales_records, monthly_objectives, lost_sales
do $$
declare t text;
begin
  for t in select unnest(array['sales_records','monthly_objectives','lost_sales']::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_tenant', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = app.current_company_id())', t || '_select_tenant', t);
    execute format('drop policy if exists %I on public.%I', t || '_modify', t);
    execute format('create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id() and (app.has_role(''company_admin'') or app.has_role(''commercial_director'') or app.has_role(''technical_director'') or app.has_role(''telemarketing_director''))) with check (company_id = app.current_company_id())', t || '_modify', t);
  end loop;
end $$;
