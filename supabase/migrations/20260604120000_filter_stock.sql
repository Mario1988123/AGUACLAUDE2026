-- =============================================================================
-- 20260604120000_filter_stock.sql
-- Auditoría post-Fase 5 del Plan Productos v2 (2026-06-04).
--
-- Crea un sistema de STOCK REAL para filtros (entidad separada de products).
-- Hasta esta migración, los filtros tenían `stock_min` y `stock_max` en
-- `product_filters` pero NINGUNA tabla guardaba cantidades reales: el
-- helper `filter-stock-predictions.ts` consultaba `warehouse_stock.filter_id`
-- que no existe y el stock salía siempre 0.
--
-- Tablas creadas:
--   - filter_stock: cantidad de un filtro en un almacén (con location opcional).
--   - filter_stock_movements: trazabilidad simple (entradas, salidas, ajustes).
--
-- RLS coherente con el módulo Productos:
--   - Lectura: cualquier rol autenticado de la empresa.
--   - Escritura: solo company_admin.
-- =============================================================================

-- =============================================================================
-- ENUM tipo de movimiento
-- =============================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'filter_stock_movement_type') then
    create type app.filter_stock_movement_type as enum (
      'purchase',       -- entrada por compra
      'usage',          -- salida (usado en mantenimiento)
      'adjustment_in',  -- ajuste manual entrada
      'adjustment_out', -- ajuste manual salida
      'transfer_in',    -- traspaso entrante (otro almacén)
      'transfer_out'    -- traspaso saliente
    );
  end if;
end $$;

-- =============================================================================
-- TABLA: filter_stock
-- =============================================================================
create table if not exists public.filter_stock (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  filter_id       uuid not null references public.product_filters(id) on delete restrict,
  location_id     uuid references public.warehouse_locations(id) on delete set null,
  quantity        integer not null default 0 check (quantity >= 0),
  updated_at      timestamptz not null default now(),
  unique (warehouse_id, filter_id, location_id)
);

create index if not exists idx_filterstock_company_filter
  on public.filter_stock(company_id, filter_id);
create index if not exists idx_filterstock_warehouse
  on public.filter_stock(warehouse_id);

create trigger trg_filterstock_updated
  before update on public.filter_stock
  for each row execute function app.set_updated_at();

comment on table public.filter_stock is
  'Stock real de filtros y recambios por almacén. Editable manualmente por admin desde /productos/filtros. Independiente de warehouse_stock (que solo gestiona products).';

-- =============================================================================
-- TABLA: filter_stock_movements (auditoría)
-- =============================================================================
create table if not exists public.filter_stock_movements (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  filter_id           uuid not null references public.product_filters(id) on delete restrict,
  warehouse_id        uuid not null references public.warehouses(id) on delete restrict,
  movement_type       app.filter_stock_movement_type not null,
  quantity            integer not null check (quantity > 0),
  destination_warehouse_id uuid references public.warehouses(id) on delete set null,
  notes               text,
  performed_by        uuid references auth.users(id) on delete set null,
  performed_at        timestamptz not null default now()
);

create index if not exists idx_filtermov_company_filter
  on public.filter_stock_movements(company_id, filter_id, performed_at desc);
create index if not exists idx_filtermov_warehouse
  on public.filter_stock_movements(warehouse_id, performed_at desc);

comment on table public.filter_stock_movements is
  'Trazabilidad simple de movimientos de stock de filtros. Editable solo por admin.';

-- =============================================================================
-- RLS — mismo régimen que el módulo Productos
-- =============================================================================
do $$
declare t text;
begin
  for t in select unnest(array['filter_stock','filter_stock_movements']::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())',
      t || '_super', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_select_tenant', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id = app.current_company_id())',
      t || '_select_tenant', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_admin_manage', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id() and app.has_role(''company_admin'')) with check (company_id = app.current_company_id() and app.has_role(''company_admin''))',
      t || '_admin_manage', t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
