-- ============================================================================
-- Tablas que el código usa y que NO existían en producción (2026-09-10)
-- ----------------------------------------------------------------------------
-- El remoto se construyó a mano y estas seis tablas se quedaron por el camino,
-- con sus migraciones escritas pero sin aplicar. Como los call-sites ignoran el
-- `{ error }` de PostgREST, la consecuencia no era un fallo visible sino una
-- pantalla a cero:
--
--   · invoice_payments              → los cobros de factura no se guardaban
--   · points_cycles                 → cierre de comisiones
--   · points_cycle_adjustments      → ajustes manuales de puntos
--   · product_price_history         → auditoría de cambios de precio
--   · proposal_payment_options      → formas de pago de una propuesta
--   · product_attribute_categories  → atributo en varias categorías
--
-- Se recogen aquí en vez de reaplicar las migraciones originales porque esos
-- ficheros llevan además funciones y ALTERs que hoy en el remoto son otra cosa
-- (`allocate_next_invoice_number`, por ejemplo, ya se endureció en julio) y
-- reaplicarlos sería volver atrás.
--
-- ⚠️ CAMBIO RESPECTO AL ORIGINAL: las políticas de points_cycles y
-- points_cycle_adjustments venían como `for all to authenticated using (true)
-- with check (true)`, o sea, cualquier usuario logueado podía tocar los ciclos
-- de CUALQUIER empresa. Es el mismo agujero cross-tenant que ya apareció en
-- `wa_admin_write`. Aquí van acotadas por company_id, como el resto.
--
-- Aditiva e idempotente.
-- ============================================================================

-- ── 1. invoice_payments ─────────────────────────────────────────────────────
create table if not exists public.invoice_payments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  wallet_entry_id uuid references public.wallet_entries(id) on delete set null,
  amount_cents    integer not null check (amount_cents > 0),
  paid_at         timestamptz not null default now(),
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_invoice_payments_invoice
  on public.invoice_payments(invoice_id, paid_at desc);
create index if not exists idx_invoice_payments_wallet
  on public.invoice_payments(wallet_entry_id);

alter table public.invoice_payments enable row level security;
alter table public.invoice_payments force row level security;

drop policy if exists invoice_payments_super on public.invoice_payments;
create policy invoice_payments_super on public.invoice_payments
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists invoice_payments_select_tenant on public.invoice_payments;
create policy invoice_payments_select_tenant on public.invoice_payments
  for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists invoice_payments_admin on public.invoice_payments;
create policy invoice_payments_admin on public.invoice_payments
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

-- ── 2. points_cycles + points_cycle_adjustments ─────────────────────────────
create table if not exists public.points_cycles (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  cycle_year      integer not null,
  cycle_month     integer not null,
  cycle_start_at  timestamptz not null,
  cycle_end_at    timestamptz not null,
  close_day       integer not null default 0,
  status          text not null default 'open' check (status in ('open','pending_review','closed')),
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id) on delete set null,
  total_points    integer not null default 0,
  total_cents     integer not null default 0,
  notes           text,
  created_at      timestamptz not null default now(),
  unique (company_id, cycle_year, cycle_month)
);
create index if not exists idx_points_cycles_company_status
  on public.points_cycles(company_id, status, cycle_year desc, cycle_month desc);

create table if not exists public.points_cycle_adjustments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  cycle_id        uuid not null references public.points_cycles(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  ledger_entry_id uuid references public.points_ledger(id) on delete set null,
  delta_points    integer not null,
  reason          text not null,
  adjusted_by     uuid not null references auth.users(id) on delete restrict,
  adjusted_at     timestamptz not null default now()
);
create index if not exists idx_pca_cycle_user
  on public.points_cycle_adjustments(cycle_id, user_id);
create index if not exists idx_pca_company
  on public.points_cycle_adjustments(company_id, adjusted_at desc);

alter table public.points_cycles enable row level security;
alter table public.points_cycles force row level security;
alter table public.points_cycle_adjustments enable row level security;
alter table public.points_cycle_adjustments force row level security;

drop policy if exists points_cycles_super on public.points_cycles;
create policy points_cycles_super on public.points_cycles
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists points_cycles_company_select on public.points_cycles;
create policy points_cycles_company_select on public.points_cycles
  for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists points_cycles_admin_write on public.points_cycles;
create policy points_cycles_admin_write on public.points_cycles
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

drop policy if exists pca_super on public.points_cycle_adjustments;
create policy pca_super on public.points_cycle_adjustments
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists pca_company_select on public.points_cycle_adjustments;
create policy pca_company_select on public.points_cycle_adjustments
  for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists pca_admin_write on public.points_cycle_adjustments;
create policy pca_admin_write on public.points_cycle_adjustments
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

comment on table public.points_cycles is
  'Ciclos de cierre de comisiones (puntos → €). Informativos: cerrar un ciclo bloquea ajustes y guarda el snapshot del total que va a nómina a mano.';
comment on table public.points_cycle_adjustments is
  'Append-only. Ajustes manuales de puntos de un usuario en un ciclo; para deshacer se crea otro con delta inverso.';

-- ── 3. product_price_history ────────────────────────────────────────────────
create table if not exists public.product_price_history (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  changed_at      timestamptz not null default now(),
  changed_by      uuid references auth.users(id) on delete set null,
  change_kind     text not null check (change_kind in (
    'cash_price','individual_price','company_price','min_authorized','cost'
  )),
  plan_type       text check (plan_type in ('cash','renting','rental') or plan_type is null),
  duration_months smallint,
  previous_cents  integer,
  new_cents       integer not null,
  reason          text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_pph_product on public.product_price_history(product_id, changed_at desc);
create index if not exists idx_pph_company on public.product_price_history(company_id);

alter table public.product_price_history enable row level security;

drop policy if exists pph_super on public.product_price_history;
create policy pph_super on public.product_price_history
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists pph_select on public.product_price_history;
create policy pph_select on public.product_price_history
  for select to authenticated using (company_id = app.current_company_id());

drop policy if exists pph_insert on public.product_price_history;
create policy pph_insert on public.product_price_history
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in ('company_admin','commercial_director')
         and ur.revoked_at is null
    )
  );

-- ── 4. proposal_payment_options ─────────────────────────────────────────────
create table if not exists public.proposal_payment_options (
  id                      uuid primary key default gen_random_uuid(),
  proposal_id             uuid not null references public.proposals(id) on delete cascade,
  company_id              uuid not null references public.companies(id) on delete cascade,
  plan_type               app.pricing_plan_type not null,
  duration_months         integer,
  monthly_cents           integer check (monthly_cents is null or monthly_cents >= 0),
  total_cents             integer not null check (total_cents >= 0),
  permanence_months       integer,
  deposit_cents           integer not null default 0,
  installation_fee_cents  integer not null default 0,
  first_payment_cents     integer,
  maintenance_included    boolean not null default false,
  maintenance_months_included integer,
  maintenance_periodicity_months integer,
  maintenance_extra_cents integer,
  is_recommended          boolean not null default false,
  display_order           integer not null default 0,
  required_price_approval boolean not null default false,
  price_approval_id       uuid,
  notes                   text
);
create index if not exists idx_ppo_proposal on public.proposal_payment_options(proposal_id);

alter table public.proposal_payment_options enable row level security;
alter table public.proposal_payment_options force row level security;

drop policy if exists proposal_payment_options_super on public.proposal_payment_options;
create policy proposal_payment_options_super on public.proposal_payment_options
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists proposal_payment_options_inherit on public.proposal_payment_options;
create policy proposal_payment_options_inherit on public.proposal_payment_options
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.proposals p
       where p.id = proposal_payment_options.proposal_id
         and p.company_id = app.current_company_id()
    )
  )
  with check (company_id = app.current_company_id());

-- ── 5. product_attribute_categories ─────────────────────────────────────────
create table if not exists public.product_attribute_categories (
  attribute_id  uuid not null references public.product_attributes(id) on delete cascade,
  category_id   uuid not null references public.product_categories(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (attribute_id, category_id)
);
create index if not exists idx_pac_attribute on public.product_attribute_categories(attribute_id);
create index if not exists idx_pac_category on public.product_attribute_categories(category_id);
create index if not exists idx_pac_company on public.product_attribute_categories(company_id);

alter table public.product_attribute_categories enable row level security;
alter table public.product_attribute_categories force row level security;

drop policy if exists pac_super on public.product_attribute_categories;
create policy pac_super on public.product_attribute_categories for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists pac_select_tenant on public.product_attribute_categories;
create policy pac_select_tenant on public.product_attribute_categories for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists pac_admin_manage on public.product_attribute_categories;
create policy pac_admin_manage on public.product_attribute_categories for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

notify pgrst, 'reload schema';
