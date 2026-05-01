-- =============================================================================
-- 20260501121700_maintenance_incidents.sql
-- Capa 2 · Mantenimientos + Customer Equipment + Incidencias
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'maintenance_status') then
    create type app.maintenance_status as enum (
      'scheduled','in_progress','completed','cancelled','rescheduled'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'maintenance_kind') then
    create type app.maintenance_kind as enum ('contracted','one_off','warranty');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'incident_priority') then
    create type app.incident_priority as enum ('low','medium','high','critical');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'incident_status') then
    create type app.incident_status as enum (
      'open','assigned','in_progress','waiting_parts','waiting_customer','resolved','closed','cancelled'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'incident_origin') then
    create type app.incident_origin as enum (
      'installation_out_of_time','installer_reported','equipment_failure','geo_out_of_range',
      'model_changed','out_of_stock','customer_complaint','other'
    );
  end if;
end $$;

-- =============================================================================
-- customer_equipment (inventario de equipos del cliente — nuestros y externos)
-- =============================================================================
create table public.customer_equipment (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  customer_id                 uuid not null references public.customers(id) on delete cascade,
  -- Si es nuestro:
  product_id                  uuid references public.products(id) on delete set null,
  -- Si es de competencia:
  external_equipment_model_id uuid references public.external_equipment_models(id) on delete set null,
  -- Donde está
  address_id                  uuid references public.addresses(id) on delete set null,
  installation_id             uuid references public.installations(id) on delete set null,
  serial_number               text,
  installed_at                date,
  warranty_until              date,
  notes                       text,
  is_active                   boolean not null default true,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  -- Uno de los dos: nuestro o de competencia
  check ((product_id is null)::int + (external_equipment_model_id is null)::int = 1)
);

create index idx_ce_customer on public.customer_equipment(customer_id) where is_active = true;
create index idx_ce_company on public.customer_equipment(company_id);
create index idx_ce_address on public.customer_equipment(address_id) where address_id is not null;

create trigger trg_ce_updated
  before update on public.customer_equipment
  for each row execute function app.set_updated_at();

-- =============================================================================
-- maintenance_jobs
-- =============================================================================
create table public.maintenance_jobs (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  customer_id         uuid not null references public.customers(id) on delete restrict,
  customer_equipment_id uuid references public.customer_equipment(id) on delete set null,
  contract_id         uuid references public.contracts(id) on delete set null,

  kind                app.maintenance_kind not null default 'contracted',
  status              app.maintenance_status not null default 'scheduled',

  -- Programación
  scheduled_at        timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  duration_seconds    integer,

  -- Asignación
  technician_user_id  uuid references auth.users(id) on delete set null,

  -- Coste / facturación
  is_charged          boolean not null default false,
  charge_cents        integer,

  -- Documento parte
  work_report_pdf_id  uuid references public.documents(id) on delete set null,
  notes               text,

  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now()
);

create index idx_mj_company_status on public.maintenance_jobs(company_id, status);
create index idx_mj_customer on public.maintenance_jobs(company_id, customer_id);
create index idx_mj_technician on public.maintenance_jobs(technician_user_id, status) where technician_user_id is not null;
create index idx_mj_scheduled on public.maintenance_jobs(company_id, scheduled_at);

create trigger trg_mj_updated
  before update on public.maintenance_jobs
  for each row execute function app.set_updated_at();

-- Cerrar FK forward
alter table public.stock_movements
  add constraint sm_maintenance_fk
  foreign key (maintenance_id) references public.maintenance_jobs(id) on delete set null;

-- maintenance_items_replaced (recambios sustituidos en este mantenimiento)
create table public.maintenance_items_replaced (
  id                  uuid primary key default gen_random_uuid(),
  maintenance_job_id  uuid not null references public.maintenance_jobs(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  quantity            integer not null check (quantity > 0),
  was_replaced        boolean not null default true,                     -- toggle desde el parte
  notes               text
);

create index idx_mir_mj on public.maintenance_items_replaced(maintenance_job_id);

-- =============================================================================
-- incidents
-- =============================================================================
create table public.incidents (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  reference_code      text,

  -- Quién/qué afecta
  customer_id         uuid references public.customers(id) on delete set null,
  customer_equipment_id uuid references public.customer_equipment(id) on delete set null,
  installation_id     uuid references public.installations(id) on delete set null,
  maintenance_job_id  uuid references public.maintenance_jobs(id) on delete set null,
  address_id          uuid references public.addresses(id) on delete set null,

  -- Detalles
  origin              app.incident_origin not null,
  priority            app.incident_priority not null default 'medium',
  status              app.incident_status not null default 'open',
  title               text not null,
  description         text,

  -- Asignación
  assigned_user_id    uuid references auth.users(id) on delete set null,
  assigned_at         timestamptz,

  -- Resolución
  resolved_at         timestamptz,
  resolved_by         uuid references auth.users(id),
  resolution_notes    text,
  closed_at           timestamptz,

  -- Si requiere sustituir equipo / cambio de modelo
  requires_replacement boolean not null default false,
  replacement_product_id uuid references public.products(id) on delete set null,
  requires_amendment   boolean not null default false,                   -- nuevo contrato/anexo

  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now()
);

create index idx_incidents_company_status on public.incidents(company_id, status);
create index idx_incidents_priority on public.incidents(company_id, priority, status);
create index idx_incidents_assigned on public.incidents(assigned_user_id) where assigned_user_id is not null;
create index idx_incidents_customer on public.incidents(company_id, customer_id) where customer_id is not null;
create index idx_incidents_installation on public.incidents(installation_id) where installation_id is not null;

create trigger trg_incidents_updated
  before update on public.incidents
  for each row execute function app.set_updated_at();

-- Cerrar FK forward de installations.incident_id
alter table public.installations
  add constraint installations_incident_fk
  foreign key (incident_id) references public.incidents(id) on delete set null;

-- =============================================================================
-- RLS
-- =============================================================================
do $$
declare t text;
begin
  for t in select unnest(array[
    'customer_equipment','maintenance_jobs','maintenance_items_replaced','incidents'
  ]::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_tenant', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = app.current_company_id())', t || '_select_tenant', t);
    execute format('drop policy if exists %I on public.%I', t || '_modify', t);
    execute format('create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id() and (app.has_role(''company_admin'') or app.has_role(''technical_director'') or app.has_role(''installer'') or app.has_role(''commercial_director'') or app.has_role(''sales_rep''))) with check (company_id = app.current_company_id())', t || '_modify', t);
  end loop;
end $$;
