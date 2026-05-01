-- =============================================================================
-- 20260501120800_leads_customers.sql
-- Capa 2 · Módulos Leads y Clientes — entidades core comerciales.
--
-- Tablas:
--   - leads                       contactos potenciales
--   - lead_contacts               contactos adicionales del lead (cuando es empresa)
--   - customers                   clientes confirmados
--   - customer_contacts           contactos adicionales del cliente
--   - customer_bank_accounts      datos bancarios (IBAN)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- enums
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'party_kind') then
    create type app.party_kind as enum ('individual','company');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type app.lead_status as enum (
      'new', 'contacted', 'proposal_created', 'proposal_sent',
      'free_trial_proposed', 'converted', 'lost', 'expired'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_origin') then
    create type app.lead_origin as enum (
      'web', 'referral', 'door_to_door', 'tmk', 'cold_call', 'event', 'social', 'other'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_potential') then
    create type app.lead_potential as enum ('A','B','C','unknown');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- leads
-- -----------------------------------------------------------------------------
create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,

  -- Tipo: empresa o particular (decisión modelo lead)
  party_kind        app.party_kind not null,

  -- Datos contacto
  -- Particular: usar first_name + last_name. Empresa: usar legal_name + trade_name + contact_first/last.
  legal_name        text,                                            -- razón social (empresa)
  trade_name        text,                                            -- nombre comercial (empresa)
  first_name        text,
  last_name         text,
  email             text,
  phone_primary     text,
  phone_company     text,                                            -- solo empresas
  tax_id            text,                                            -- DNI/NIE/CIF (validación en app)

  -- Estado y clasificación
  status            app.lead_status not null default 'new',
  origin            app.lead_origin not null default 'other',
  potential         app.lead_potential not null default 'unknown',
  notes             text,
  tags              text[] default array[]::text[],

  -- Origen TMK (decisión 1.8 + comisiones)
  origin_tmk_user_id uuid references auth.users(id) on delete set null, -- teleoperador que lo creó
  -- (origin = 'tmk' implica origin_tmk_user_id no nulo, validar en app)

  -- Asignación
  assigned_user_id  uuid references auth.users(id) on delete set null,
  assigned_at       timestamptz,
  assigned_by       uuid references auth.users(id) on delete set null,

  -- Conversión
  converted_at      timestamptz,
  converted_to_customer_id uuid,                                     -- FK añadida después (forward ref a customers)
  lost_reason       text,
  lost_at           timestamptz,
  expired_at        timestamptz,

  -- Auditoría
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz                                      -- soft-delete
);

create index idx_leads_company_status on public.leads(company_id, status) where deleted_at is null;
create index idx_leads_assigned on public.leads(company_id, assigned_user_id) where deleted_at is null and assigned_user_id is not null;
create index idx_leads_origin on public.leads(company_id, origin);
create index idx_leads_created on public.leads(company_id, created_at desc);
create index idx_leads_email on public.leads(company_id, lower(email)) where email is not null;
create index idx_leads_phone on public.leads(company_id, phone_primary) where phone_primary is not null;

create trigger trg_leads_updated
  before update on public.leads
  for each row execute function app.set_updated_at();

comment on table public.leads is
  'Contactos potenciales (no clientes todavía). Estados: new -> contacted -> ... -> converted | lost | expired.';

-- -----------------------------------------------------------------------------
-- lead_contacts (contactos adicionales para leads de tipo empresa)
-- -----------------------------------------------------------------------------
create table public.lead_contacts (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  first_name   text,
  last_name    text,
  job_title    text,
  email        text,
  phone        text,
  is_primary   boolean default false,
  notes        text,
  created_at   timestamptz not null default now()
);

create index idx_lead_contacts_lead on public.lead_contacts(lead_id);

-- -----------------------------------------------------------------------------
-- customers
-- -----------------------------------------------------------------------------
create table public.customers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,

  -- Tipo y datos
  party_kind        app.party_kind not null,
  legal_name        text,
  trade_name        text,
  first_name        text,
  last_name         text,
  email             text,
  phone_primary     text,
  phone_secondary   text,
  tax_id            text,                                            -- DNI/CIF validado por app

  -- Logo opcional
  logo_url          text,

  -- Origen
  source_lead_id    uuid references public.leads(id) on delete set null,

  -- Asignación
  assigned_user_id  uuid references auth.users(id) on delete set null,
  assigned_at       timestamptz,

  -- Estado activo/inactivo
  is_active         boolean not null default true,

  -- Notas
  notes             text,
  tags              text[] default array[]::text[],

  -- Auditoría
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz                                      -- soft-delete
);

create index idx_customers_company on public.customers(company_id) where deleted_at is null;
create index idx_customers_assigned on public.customers(company_id, assigned_user_id) where deleted_at is null and assigned_user_id is not null;
create index idx_customers_email on public.customers(company_id, lower(email)) where email is not null and deleted_at is null;
create index idx_customers_phone on public.customers(company_id, phone_primary) where deleted_at is null;
create index idx_customers_tax on public.customers(company_id, tax_id) where tax_id is not null;

create trigger trg_customers_updated
  before update on public.customers
  for each row execute function app.set_updated_at();

-- Ahora que customers existe, añadimos la FK desde leads.converted_to_customer_id
alter table public.leads
  add constraint leads_converted_to_customer_fk
  foreign key (converted_to_customer_id) references public.customers(id) on delete set null;

comment on table public.customers is
  'Clientes confirmados con datos validados. Soft-delete por valor legal/contractual.';

-- -----------------------------------------------------------------------------
-- customer_contacts
-- -----------------------------------------------------------------------------
create table public.customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  first_name   text,
  last_name    text,
  job_title    text,
  email        text,
  phone        text,
  is_primary   boolean default false,
  notes        text,
  created_at   timestamptz not null default now()
);

create index idx_customer_contacts_customer on public.customer_contacts(customer_id);

-- -----------------------------------------------------------------------------
-- customer_bank_accounts (datos bancarios — sensibles)
-- -----------------------------------------------------------------------------
create table public.customer_bank_accounts (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references public.customers(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  account_holder_name text,
  iban                text not null check (length(iban) between 15 and 34),
  bic                 text,
  bank_name           text,
  is_primary          boolean default true,
  is_validated        boolean default false,                          -- validación dígitos control hecha en app
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  deleted_at          timestamptz
);

create index idx_customer_bank_customer on public.customer_bank_accounts(customer_id) where deleted_at is null;

comment on table public.customer_bank_accounts is
  'IBANs del cliente. Solo company_admin lo ve completo (field_restrictions). Soft-delete.';

-- =============================================================================
-- RLS
-- =============================================================================

-- ----- leads
alter table public.leads enable row level security;
alter table public.leads force row level security;

drop policy if exists leads_super on public.leads;
create policy leads_super on public.leads
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- SELECT por scope
drop policy if exists leads_select_by_scope on public.leads;
create policy leads_select_by_scope on public.leads
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      -- all_company
      app.can('leads', 'view', 'all_company')
      -- department: comercial o tmk según user
      or (app.can('leads', 'view', 'department') and (
            app.in_department('sales') or app.in_department('tmk')
         ))
      -- own
      or (app.can('leads', 'view', 'own') and (
            assigned_user_id = auth.uid()
            or created_by = auth.uid()
            or origin_tmk_user_id = auth.uid()
         ))
    )
  );

drop policy if exists leads_insert_by_scope on public.leads;
create policy leads_insert_by_scope on public.leads
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and (
      app.can('leads','create','all_company')
      or app.can('leads','create','department')
      or app.can('leads','create','own')
    )
  );

drop policy if exists leads_update_by_scope on public.leads;
create policy leads_update_by_scope on public.leads
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.can('leads','update','all_company')
      or (app.can('leads','update','department') and (
            app.in_department('sales') or app.in_department('tmk')
         ))
      or (app.can('leads','update','own') and (
            assigned_user_id = auth.uid() or created_by = auth.uid()
         ))
    )
  )
  with check (company_id = app.current_company_id());

drop policy if exists leads_delete_admin on public.leads;
create policy leads_delete_admin on public.leads
  for delete to authenticated
  using (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );

-- ----- lead_contacts (hereda visibilidad del lead)
alter table public.lead_contacts enable row level security;
alter table public.lead_contacts force row level security;

drop policy if exists lead_contacts_super on public.lead_contacts;
create policy lead_contacts_super on public.lead_contacts
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists lead_contacts_tenant on public.lead_contacts;
create policy lead_contacts_tenant on public.lead_contacts
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.leads l
       where l.id = lead_contacts.lead_id
         and l.company_id = app.current_company_id()
    )
  )
  with check (company_id = app.current_company_id());

-- ----- customers
alter table public.customers enable row level security;
alter table public.customers force row level security;

drop policy if exists customers_super on public.customers;
create policy customers_super on public.customers
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists customers_select_by_scope on public.customers;
create policy customers_select_by_scope on public.customers
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      app.can('customers','view','all_company')
      or (app.can('customers','view','department') and app.in_department('sales'))
      or (app.can('customers','view','own') and (
            assigned_user_id = auth.uid()
            or exists (select 1 from public.leads l where l.converted_to_customer_id = customers.id and l.created_by = auth.uid())
         ))
      -- Nivel 3 instalador: ve cliente solo si tiene una instalación activa asignada (lo afina policy de installations)
      -- aquí permitimos el join lookup vía exists
      or (app.has_role('installer') and exists (
            select 1 from public.team_assignments  -- placeholder hasta crear installations
             where false
         ))
    )
  );

drop policy if exists customers_insert_by_scope on public.customers;
create policy customers_insert_by_scope on public.customers
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and (
      app.can('customers','create','all_company')
      or app.can('customers','create','department')
      or app.can('customers','create','own')
    )
  );

drop policy if exists customers_update_by_scope on public.customers;
create policy customers_update_by_scope on public.customers
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      app.can('customers','update','all_company')
      or (app.can('customers','update','department') and app.in_department('sales'))
      or (app.can('customers','update','own') and assigned_user_id = auth.uid())
    )
  )
  with check (company_id = app.current_company_id());

drop policy if exists customers_delete_admin on public.customers;
create policy customers_delete_admin on public.customers
  for delete to authenticated
  using (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );

-- ----- customer_contacts
alter table public.customer_contacts enable row level security;
alter table public.customer_contacts force row level security;

drop policy if exists customer_contacts_super on public.customer_contacts;
create policy customer_contacts_super on public.customer_contacts
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists customer_contacts_tenant on public.customer_contacts;
create policy customer_contacts_tenant on public.customer_contacts
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.customers c
       where c.id = customer_contacts.customer_id
         and c.company_id = app.current_company_id()
         and c.deleted_at is null
    )
  )
  with check (company_id = app.current_company_id());

-- ----- customer_bank_accounts (más restrictivo: solo admin lee)
alter table public.customer_bank_accounts enable row level security;
alter table public.customer_bank_accounts force row level security;

drop policy if exists cust_bank_super on public.customer_bank_accounts;
create policy cust_bank_super on public.customer_bank_accounts
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists cust_bank_admin_only on public.customer_bank_accounts;
create policy cust_bank_admin_only on public.customer_bank_accounts
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
    and deleted_at is null
  )
  with check (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );
