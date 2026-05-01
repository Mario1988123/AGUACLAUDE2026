-- =============================================================================
-- 20260501121300_contracts.sql
-- Capa 2 · Módulo Contratos.
--
-- Tablas:
--   - contracts                    contrato firmado o en preparación
--   - contract_items               productos del contrato (snapshot del producto)
--   - contract_payments            pagos previstos/realizados (fianza, cuota, etc.)
--   - contract_signatures          firmas (cliente y representante empresa)
--   - contract_clauses_templates   plantillas de cláusulas configurables
--   - contract_clauses_used        cláusulas concretas usadas en cada contrato
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'contract_status') then
    create type app.contract_status as enum (
      'draft',                  -- borrador
      'pending_data',           -- pendiente de datos cliente (DNI/IBAN provisionales)
      'pending_signature',      -- listo para firmar
      'signed',                 -- firmado
      'active',                 -- vigente (post-firma)
      'completed',              -- finalizado (cumplimiento)
      'cancelled'               -- cancelado
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_method') then
    create type app.payment_method as enum (
      'cash','card','bizum','transfer','direct_debit','financing'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_moment') then
    create type app.payment_moment as enum (
      'on_signature','on_installation','intermediate','periodic'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type app.payment_status as enum (
      'pending','collected_pending_validation','validated','rejected','cancelled'
    );
  end if;
end $$;

create table public.contracts (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  customer_id                 uuid not null references public.customers(id) on delete restrict,
  source_proposal_id          uuid references public.proposals(id) on delete set null,
  source_free_trial_id        uuid,                                   -- FK añadida después en migración free_trials

  -- Plan elegido
  plan_type                   app.pricing_plan_type not null,
  duration_months             integer,
  permanence_months           integer,

  -- Importes denormalizados (snapshot)
  total_cash_cents            integer,
  monthly_cents               integer,

  -- Estado
  status                      app.contract_status not null default 'draft',
  reference_code              text,                                    -- "C-2026-0001"

  -- Datos provisionales (no bloquea borrador, advierte antes firma)
  has_provisional_data        boolean not null default false,

  -- Firma
  signed_at                   timestamptz,
  signed_by_user_id           uuid references auth.users(id),

  -- Mantenimientos contratados
  maintenance_included        boolean not null default false,
  maintenance_months_included integer,
  maintenance_periodicity_months integer,
  maintenance_extra_cents     integer,

  -- Datos snapshot del cliente para integridad legal
  customer_snapshot           jsonb,                                   -- nombre, DNI/CIF, dirección al firmar
  representative_user_id      uuid references auth.users(id),          -- representante de la empresa que firma
  representative_snapshot     jsonb,

  -- Banco snapshot
  bank_account_snapshot       jsonb,

  -- Documentos generados
  pdf_document_id             uuid references public.documents(id) on delete set null,

  notes                       text,
  internal_notes              text,
  created_at                  timestamptz not null default now(),
  created_by                  uuid references auth.users(id) on delete set null,
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz
);

create index idx_contracts_company_status on public.contracts(company_id, status) where deleted_at is null;
create index idx_contracts_customer on public.contracts(company_id, customer_id) where deleted_at is null;
create index idx_contracts_proposal on public.contracts(source_proposal_id) where source_proposal_id is not null;

create trigger trg_contracts_updated
  before update on public.contracts
  for each row execute function app.set_updated_at();

-- Auditoría completa de contracts (decisión #8 audit)
create trigger trg_contracts_audit
  after insert or update or delete on public.contracts
  for each row execute function app.audit_trigger();

comment on table public.contracts is
  'Contratos. Status pending_data si DNI/IBAN provisionales; bloquear firma hasta validar.';

-- =============================================================================
-- contract_items
-- =============================================================================
create table public.contract_items (
  id                          uuid primary key default gen_random_uuid(),
  contract_id                 uuid not null references public.contracts(id) on delete cascade,
  company_id                  uuid not null references public.companies(id) on delete cascade,
  product_id                  uuid not null references public.products(id) on delete restrict,
  quantity                    integer not null default 1 check (quantity > 0),
  -- Snapshot inmutable
  product_name_snapshot       text not null,
  product_kind_snapshot       app.product_kind not null,
  unit_price_cents            integer not null,
  -- Dirección de instalación elegida
  installation_address_id     uuid references public.addresses(id) on delete set null,
  display_order               integer not null default 0,
  notes                       text
);

create index idx_ci_contract on public.contract_items(contract_id);

-- =============================================================================
-- contract_payments
-- =============================================================================
create table public.contract_payments (
  id                          uuid primary key default gen_random_uuid(),
  contract_id                 uuid not null references public.contracts(id) on delete cascade,
  company_id                  uuid not null references public.companies(id) on delete cascade,

  concept                     text not null,                           -- "Fianza", "Instalación", "Primera cuota", "Pago contado"...
  amount_cents                integer not null check (amount_cents >= 0),
  method                      app.payment_method not null,
  moment                      app.payment_moment not null,
  status                      app.payment_status not null default 'pending',

  -- Cuándo se cobra realmente
  collected_at                timestamptz,
  collected_by_user_id        uuid references auth.users(id),
  validated_at                timestamptz,
  validated_by_user_id        uuid references auth.users(id),

  -- Justificante (si method = card/transfer/bizum)
  receipt_document_id         uuid references public.documents(id) on delete set null,

  -- Si genera entrada en wallet
  wallet_entry_id             uuid,                                    -- FK forward a wallet_entries

  notes                       text,
  display_order               integer not null default 0,
  created_at                  timestamptz not null default now()
);

create index idx_cp_contract on public.contract_payments(contract_id);
create index idx_cp_status on public.contract_payments(company_id, status);

create trigger trg_cp_audit
  after insert or update or delete on public.contract_payments
  for each row execute function app.audit_trigger();

-- =============================================================================
-- contract_signatures
-- =============================================================================
create table public.contract_signatures (
  id                  uuid primary key default gen_random_uuid(),
  contract_id         uuid not null references public.contracts(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  signer_role         text not null check (signer_role in ('customer','representative')),
  signer_name         text not null,
  signer_tax_id       text,
  signature_image_path text not null,                                  -- Storage path PNG
  signed_at           timestamptz not null default now(),
  ip_address          inet,
  user_agent          text,
  geo_latitude        numeric(9,6),
  geo_longitude       numeric(9,6)
);

create index idx_cs_contract on public.contract_signatures(contract_id);

-- =============================================================================
-- Cláusulas de contrato (configurables por empresa)
-- =============================================================================
create table public.contract_clause_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  key           text not null,                                          -- "duration", "permanence", "data_protection"...
  title         text not null,
  body_template text not null,                                          -- texto con variables {{customer_name}}, {{amount}}, etc.
  display_order integer not null default 0,
  is_required   boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (company_id, key)
);

create index idx_cct_company on public.contract_clause_templates(company_id);

create table public.contract_clauses_used (
  id              uuid primary key default gen_random_uuid(),
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  template_id     uuid references public.contract_clause_templates(id) on delete set null,
  title_snapshot  text not null,
  body_snapshot   text not null,
  display_order   integer not null default 0
);

create index idx_ccu_contract on public.contract_clauses_used(contract_id);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.contracts enable row level security;
alter table public.contracts force row level security;

drop policy if exists contracts_super on public.contracts;
create policy contracts_super on public.contracts for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists contracts_select_by_scope on public.contracts;
create policy contracts_select_by_scope on public.contracts
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      app.can('contracts','view','all_company')
      or (app.can('contracts','view','department') and app.in_department('sales'))
      or (app.can('contracts','view','own') and created_by = auth.uid())
    )
  );

drop policy if exists contracts_insert_by_scope on public.contracts;
create policy contracts_insert_by_scope on public.contracts
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and (
      app.can('contracts','create','all_company')
      or app.can('contracts','create','department')
      or app.can('contracts','create','own')
    )
  );

drop policy if exists contracts_update_by_scope on public.contracts;
create policy contracts_update_by_scope on public.contracts
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and status in ('draft','pending_data','pending_signature')
    and (
      app.can('contracts','update','all_company')
      or (app.can('contracts','update','department') and app.in_department('sales'))
      or (app.can('contracts','update','own') and created_by = auth.uid())
    )
  )
  with check (company_id = app.current_company_id());

-- Tablas hijas
do $$
declare t text;
begin
  for t in select unnest(array[
    'contract_items','contract_payments','contract_signatures',
    'contract_clause_templates','contract_clauses_used'
  ]::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
    execute format('drop policy if exists %I on public.%I', t || '_tenant_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = app.current_company_id())', t || '_tenant_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_manage', t);
    execute format('create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id() and (app.has_role(''company_admin'') or app.has_role(''commercial_director'') or app.has_role(''sales_rep''))) with check (company_id = app.current_company_id())', t || '_admin_manage', t);
  end loop;
end $$;
