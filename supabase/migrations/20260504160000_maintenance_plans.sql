-- =============================================================================
-- 20260504160000_maintenance_plans.sql
-- Planes de mantenimiento (Lite / Medium / Premium) y contratos de
-- mantenimiento independientes con remesa mensual + factura mensual.
--
--   - maintenance_plans         catálogo por empresa (3 niveles seedeados)
--   - maintenance_contracts     contrato de mantenimiento del cliente
--                               (independiente del contrato principal o
--                               creado tras la instalación)
-- =============================================================================

-- ============================================================
-- 1) maintenance_plans (catálogo por empresa)
-- ============================================================
create table if not exists public.maintenance_plans (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  tier            text not null check (tier in ('lite','medium','premium')),
  name            text not null,
  monthly_cents   integer not null check (monthly_cents >= 0),
  visits_per_year integer,                 -- null = ilimitadas
  parts_discount_percent integer not null default 0
    check (parts_discount_percent between 0 and 100),
  spare_equipment_included boolean not null default false,
  description     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (company_id, tier)
);

create index if not exists idx_maintenance_plans_company
  on public.maintenance_plans(company_id) where is_active;

alter table public.maintenance_plans enable row level security;

drop policy if exists mp_super on public.maintenance_plans;
create policy mp_super on public.maintenance_plans
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists mp_select_tenant on public.maintenance_plans;
create policy mp_select_tenant on public.maintenance_plans
  for select to authenticated using (company_id = app.current_company_id());

drop policy if exists mp_admin_manage on public.maintenance_plans;
create policy mp_admin_manage on public.maintenance_plans
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));


-- ============================================================
-- 2) maintenance_contracts (contrato de mantenimiento del cliente)
-- ============================================================
create table if not exists public.maintenance_contracts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  customer_id         uuid not null references public.customers(id) on delete restrict,
  plan_id             uuid not null references public.maintenance_plans(id) on delete restrict,
  /** Origen: instalación, contrato principal o manual */
  source_installation_id uuid references public.installations(id) on delete set null,
  source_contract_id  uuid references public.contracts(id) on delete set null,
  /** Snapshots inmutables al firmar */
  tier_snapshot       text not null,
  monthly_cents_snapshot integer not null,
  visits_per_year_snapshot integer,
  parts_discount_snapshot integer not null default 0,
  spare_equipment_snapshot boolean not null default false,

  /** Remesa */
  iban_snapshot       text,
  iban_holder_snapshot text,

  status              text not null default 'active'
    check (status in ('draft','active','paused','cancelled','expired')),
  reference_code      text,                                   -- "M-2026-0001"
  starts_on           date not null default current_date,
  ends_on             date,                                   -- null = indefinido
  visits_used_this_year integer not null default 0,
  cancelled_at        timestamptz,
  cancelled_reason    text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create index if not exists idx_maint_contracts_customer
  on public.maintenance_contracts(company_id, customer_id) where deleted_at is null;
create index if not exists idx_maint_contracts_status
  on public.maintenance_contracts(company_id, status) where deleted_at is null;

drop trigger if exists trg_maint_contracts_updated on public.maintenance_contracts;
create trigger trg_maint_contracts_updated
  before update on public.maintenance_contracts
  for each row execute function app.set_updated_at();

alter table public.maintenance_contracts enable row level security;

drop policy if exists mc_super on public.maintenance_contracts;
create policy mc_super on public.maintenance_contracts
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists mc_tenant on public.maintenance_contracts;
create policy mc_tenant on public.maintenance_contracts
  for all to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());


-- ============================================================
-- 3) Seed automático de los 3 planes para empresas existentes
-- ============================================================
do $$
declare
  c record;
begin
  for c in select id from public.companies loop
    insert into public.maintenance_plans
      (company_id, tier, name, monthly_cents, visits_per_year, parts_discount_percent, spare_equipment_included, description)
    values
      (c.id, 'lite',    'Lite',    1000, 1,    0,  false,
       'Una visita al año para cambio de filtros. Cualquier visita extra o incidencia se cobra aparte.'),
      (c.id, 'medium',  'Medium',  1500, 2,    30, false,
       'Dos visitas al año + 30 % de descuento en piezas.'),
      (c.id, 'premium', 'Premium', 2000, null, 50, true,
       'Visitas ilimitadas + 50 % de descuento en piezas + equipo de recambio incluido.')
    on conflict (company_id, tier) do nothing;
  end loop;
end $$;

notify pgrst, 'reload schema';
