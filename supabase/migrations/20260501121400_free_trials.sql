-- =============================================================================
-- 20260501121400_free_trials.sql
-- Capa 2 · Módulo Pruebas Gratuitas.
-- DECISIÓN #17: entidad independiente. NO es contrato. Si acepta -> nuevo contrato.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'free_trial_status') then
    create type app.free_trial_status as enum (
      'draft','scheduled','installed','accepted','rejected','removed','expired'
    );
  end if;
end $$;

create table public.free_trials (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,

  -- Dueño (lead o customer)
  lead_id             uuid references public.leads(id) on delete restrict,
  customer_id         uuid references public.customers(id) on delete restrict,

  -- Dirección de instalación
  installation_address_id uuid references public.addresses(id) on delete restrict,

  status              app.free_trial_status not null default 'draft',
  reference_code      text,

  -- Configuración (sale de /configuracion/pruebas-gratuitas)
  duration_days       integer not null default 30 check (duration_days > 0),
  conditions_text     text,                                              -- texto de condiciones aceptadas
  conditions_signed   boolean not null default false,

  -- Fechas clave
  scheduled_at        timestamptz,
  installed_at        timestamptz,
  expires_at          timestamptz,                                       -- installed_at + duration_days
  decided_at          timestamptz,                                       -- aceptado/rechazado
  decided_outcome     text check (decided_outcome in ('accepted','rejected')),
  removed_at          timestamptz,
  rejected_reason     text,

  -- Conversión a contrato
  generated_contract_id uuid references public.contracts(id) on delete set null,

  -- Albarán de entrega (es un PDF)
  delivery_note_document_id uuid references public.documents(id) on delete set null,

  -- Asignaciones
  assigned_installer_user_id uuid references auth.users(id) on delete set null,
  created_by                 uuid references auth.users(id) on delete set null,

  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  check ((lead_id is null)::int + (customer_id is null)::int = 1)
);

create index idx_ft_company_status on public.free_trials(company_id, status) where deleted_at is null;
create index idx_ft_customer on public.free_trials(company_id, customer_id) where customer_id is not null and deleted_at is null;
create index idx_ft_installer on public.free_trials(assigned_installer_user_id) where deleted_at is null and assigned_installer_user_id is not null;

create trigger trg_ft_updated
  before update on public.free_trials
  for each row execute function app.set_updated_at();

-- Ahora añadimos la FK desde contracts.source_free_trial_id (forward reference resuelto)
alter table public.contracts
  add constraint contracts_source_free_trial_fk
  foreign key (source_free_trial_id) references public.free_trials(id) on delete set null;

-- free_trial_items (productos en prueba — descuentan stock como "en prueba")
create table public.free_trial_items (
  id                  uuid primary key default gen_random_uuid(),
  free_trial_id       uuid not null references public.free_trials(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  quantity            integer not null default 1 check (quantity > 0),
  product_name_snapshot text not null,
  -- Estado del equipo concreto (para gestionar reentrada al stock)
  serial_number       text,
  stock_state_on_return text check (stock_state_on_return in ('new','used','damaged','lost')),
  notes               text
);

create index idx_fti_ft on public.free_trial_items(free_trial_id);

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.free_trials enable row level security;
alter table public.free_trials force row level security;

drop policy if exists ft_super on public.free_trials;
create policy ft_super on public.free_trials for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists ft_select_by_scope on public.free_trials;
create policy ft_select_by_scope on public.free_trials
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      app.can('free_trials','view','all_company')
      or (app.can('free_trials','view','department') and (app.in_department('sales') or app.in_department('tech')))
      or (app.can('free_trials','view','own') and (
            created_by = auth.uid()
            or assigned_installer_user_id = auth.uid()
         ))
    )
  );

drop policy if exists ft_insert on public.free_trials;
create policy ft_insert on public.free_trials
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and (
      app.can('free_trials','create','all_company')
      or app.can('free_trials','create','department')
      or app.can('free_trials','create','own')
    )
  );

drop policy if exists ft_update on public.free_trials;
create policy ft_update on public.free_trials
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and status not in ('accepted','rejected','expired','removed')
    and (
      app.can('free_trials','update','all_company')
      or (app.can('free_trials','update','department') and (app.in_department('sales') or app.in_department('tech')))
      or (app.can('free_trials','update','own') and (created_by = auth.uid() or assigned_installer_user_id = auth.uid()))
    )
  )
  with check (company_id = app.current_company_id());

alter table public.free_trial_items enable row level security;
alter table public.free_trial_items force row level security;

drop policy if exists fti_super on public.free_trial_items;
create policy fti_super on public.free_trial_items for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists fti_inherit on public.free_trial_items;
create policy fti_inherit on public.free_trial_items
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (select 1 from public.free_trials f where f.id = free_trial_items.free_trial_id and f.company_id = app.current_company_id())
  )
  with check (company_id = app.current_company_id());
