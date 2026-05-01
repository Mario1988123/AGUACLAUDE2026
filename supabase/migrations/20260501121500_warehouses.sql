-- =============================================================================
-- 20260501121500_warehouses.sql
-- Capa 2 · Módulo Almacenes / furgonetas / carga / stock.
--
-- Tablas:
--   - warehouses                almacenes y furgonetas
--   - warehouse_locations       ubicaciones internas (estantería, altura, posición)
--   - warehouse_stock           stock por (warehouse, product) — snapshot
--   - stock_movements           historial movimientos
--   - loading_requests          solicitudes de carga a furgoneta
--   - loading_request_items     items por solicitud
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'warehouse_kind') then
    create type app.warehouse_kind as enum ('main','secondary','vehicle','external_supplier');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'stock_movement_type') then
    create type app.stock_movement_type as enum (
      'inbound',         -- entrada de proveedor
      'outbound_install',-- salida por instalación
      'outbound_trial',  -- salida por prueba gratuita
      'outbound_maintenance', -- salida por mantenimiento (recambio)
      'transfer_out',    -- salida por transferencia entre almacenes
      'transfer_in',     -- entrada por transferencia
      'return',          -- devolución (de prueba gratuita)
      'adjustment_plus', -- ajuste positivo de inventario
      'adjustment_minus' -- ajuste negativo
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'loading_request_status') then
    create type app.loading_request_status as enum (
      'requested','preparing','prepared','in_transit','delivered','cancelled'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'stock_unit_state') then
    create type app.stock_unit_state as enum ('new','used','damaged','reserved_trial');
  end if;
end $$;

create table public.warehouses (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  kind            app.warehouse_kind not null default 'main',
  -- Si es vehículo, asignado a usuario
  assigned_user_id uuid references auth.users(id) on delete set null,
  vehicle_plate    text,
  address_id       uuid references public.addresses(id) on delete set null,  -- opcional para fijos
  is_active        boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (company_id, name)
);

create index idx_warehouses_company on public.warehouses(company_id) where deleted_at is null;
create index idx_warehouses_kind on public.warehouses(company_id, kind);
create index idx_warehouses_user on public.warehouses(assigned_user_id) where assigned_user_id is not null;

create trigger trg_warehouses_updated
  before update on public.warehouses
  for each row execute function app.set_updated_at();

create table public.warehouse_locations (
  id            uuid primary key default gen_random_uuid(),
  warehouse_id  uuid not null references public.warehouses(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  code          text not null,                                          -- "4A2"
  description   text,
  unique (warehouse_id, code)
);

create index idx_wloc_warehouse on public.warehouse_locations(warehouse_id);

create table public.warehouse_stock (
  id              uuid primary key default gen_random_uuid(),
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete restrict,
  company_id      uuid not null references public.companies(id) on delete cascade,
  location_id     uuid references public.warehouse_locations(id) on delete set null,
  quantity        integer not null default 0 check (quantity >= 0),
  state           app.stock_unit_state not null default 'new',
  updated_at      timestamptz not null default now(),
  unique (warehouse_id, product_id, state, location_id)
);

create index idx_ws_company_product on public.warehouse_stock(company_id, product_id);
create index idx_ws_warehouse on public.warehouse_stock(warehouse_id);

create trigger trg_ws_updated
  before update on public.warehouse_stock
  for each row execute function app.set_updated_at();

create table public.stock_movements (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  warehouse_id        uuid not null references public.warehouses(id) on delete restrict,
  destination_warehouse_id uuid references public.warehouses(id) on delete set null,
  movement_type       app.stock_movement_type not null,
  quantity            integer not null check (quantity > 0),
  state_after         app.stock_unit_state,
  -- Vínculos a entidades que generaron el movimiento
  installation_id     uuid,                                              -- FK forward
  free_trial_id       uuid references public.free_trials(id) on delete set null,
  maintenance_id      uuid,                                              -- FK forward
  loading_request_id  uuid,                                              -- FK forward
  -- Auditoría
  performed_by        uuid references auth.users(id) on delete set null,
  performed_at        timestamptz not null default now(),
  notes               text
);

create index idx_sm_company_product on public.stock_movements(company_id, product_id, performed_at desc);
create index idx_sm_warehouse on public.stock_movements(warehouse_id, performed_at desc);
create index idx_sm_install on public.stock_movements(installation_id) where installation_id is not null;

-- =============================================================================
-- loading_requests / loading_request_items
-- =============================================================================
create table public.loading_requests (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  source_warehouse_id     uuid not null references public.warehouses(id),
  destination_warehouse_id uuid not null references public.warehouses(id),
  status                  app.loading_request_status not null default 'requested',
  -- Cuándo se necesita
  needed_for              date,                                           -- p.ej. instalaciones del día siguiente
  -- Quién pide / prepara
  requested_by            uuid references auth.users(id),
  prepared_by             uuid references auth.users(id),
  delivered_by            uuid references auth.users(id),
  prepared_at             timestamptz,
  delivered_at            timestamptz,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  check (source_warehouse_id <> destination_warehouse_id)
);

create index idx_lr_company_status on public.loading_requests(company_id, status);
create index idx_lr_destination on public.loading_requests(destination_warehouse_id, status);

create trigger trg_lr_updated
  before update on public.loading_requests
  for each row execute function app.set_updated_at();

create table public.loading_request_items (
  id                  uuid primary key default gen_random_uuid(),
  loading_request_id  uuid not null references public.loading_requests(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  quantity_requested  integer not null check (quantity_requested > 0),
  quantity_prepared   integer,
  quantity_delivered  integer,
  notes               text
);

create index idx_lri_request on public.loading_request_items(loading_request_id);

-- Cerrar FK forward
alter table public.stock_movements
  add constraint sm_loading_request_fk
  foreign key (loading_request_id) references public.loading_requests(id) on delete set null;

-- =============================================================================
-- RLS
-- =============================================================================
do $$
declare t text;
begin
  for t in select unnest(array[
    'warehouses','warehouse_locations','warehouse_stock','stock_movements',
    'loading_requests','loading_request_items'
  ]::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_tenant', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = app.current_company_id())', t || '_select_tenant', t);
    execute format('drop policy if exists %I on public.%I', t || '_modify', t);
    execute format('create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id() and (app.has_role(''company_admin'') or app.has_role(''technical_director'') or app.has_role(''installer''))) with check (company_id = app.current_company_id())', t || '_modify', t);
  end loop;
end $$;
