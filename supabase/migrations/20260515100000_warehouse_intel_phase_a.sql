-- =============================================================================
-- Almacenes inteligente — Fase A
-- =============================================================================
-- Decisiones usuario 2026-05-09:
--  - Productos: stock_max + lead_time_days + default_supplier_name (texto libre).
--  - Min/max por (warehouse, product) → tabla warehouse_stock_thresholds.
--  - Movimientos con trazabilidad: purchase_id, contract_id, invoice_id, reason.
--  - Sin tabla suppliers, sin caducidad por lote (en esta fase).
-- =============================================================================

-- 1) Productos: campos de gestión de stock
alter table public.products
  add column if not exists stock_max integer,
  add column if not exists lead_time_days integer,
  add column if not exists default_supplier_name text;

comment on column public.products.stock_max is
  'Stock máximo informativo (para no sobrestockar). No bloquea, solo avisa.';
comment on column public.products.lead_time_days is
  'Días desde que se hace el pedido al proveedor hasta que entra en stock. Usado por el sistema predictivo de alertas.';
comment on column public.products.default_supplier_name is
  'Nombre del proveedor habitual (texto libre). Para acelerar el alta de compras.';

-- 2) Min/max por almacén-producto (override sobre products.stock_min global)
create table if not exists public.warehouse_stock_thresholds (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  stock_min       integer not null default 0 check (stock_min >= 0),
  stock_max       integer check (stock_max is null or stock_max >= stock_min),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (warehouse_id, product_id)
);

create index if not exists idx_wst_warehouse on public.warehouse_stock_thresholds(warehouse_id);
create index if not exists idx_wst_company_product on public.warehouse_stock_thresholds(company_id, product_id);

drop trigger if exists trg_wst_updated on public.warehouse_stock_thresholds;
create trigger trg_wst_updated
  before update on public.warehouse_stock_thresholds
  for each row execute function app.set_updated_at();

alter table public.warehouse_stock_thresholds enable row level security;
alter table public.warehouse_stock_thresholds force row level security;

drop policy if exists wst_super on public.warehouse_stock_thresholds;
create policy wst_super on public.warehouse_stock_thresholds for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists wst_select_tenant on public.warehouse_stock_thresholds;
create policy wst_select_tenant on public.warehouse_stock_thresholds for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists wst_modify on public.warehouse_stock_thresholds;
create policy wst_modify on public.warehouse_stock_thresholds for all to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin') or app.has_role('technical_director'))
  )
  with check (company_id = app.current_company_id());

comment on table public.warehouse_stock_thresholds is
  'Min/max de stock por (almacén, producto). Si no existe entrada para un par, se usa products.stock_min global como fallback.';

-- 3) Trazabilidad de movimientos: enlazar compras / ventas / facturas
alter table public.stock_movements
  add column if not exists purchase_id uuid,           -- FK forward a purchases (Fase C)
  add column if not exists contract_id uuid references public.contracts(id) on delete set null,
  add column if not exists invoice_id  uuid references public.invoices(id) on delete set null,
  add column if not exists reason      text;

create index if not exists idx_sm_contract on public.stock_movements(contract_id) where contract_id is not null;
create index if not exists idx_sm_invoice  on public.stock_movements(invoice_id) where invoice_id is not null;
create index if not exists idx_sm_purchase on public.stock_movements(purchase_id) where purchase_id is not null;

comment on column public.stock_movements.purchase_id is
  'Compra (albarán/factura proveedor) que originó la entrada. FK se cierra en Fase C cuando exista la tabla purchases.';
comment on column public.stock_movements.contract_id is
  'Contrato del cliente que justifica la salida (instalación, recambio en mantenimiento, etc.).';
comment on column public.stock_movements.invoice_id is
  'Factura emitida que corresponde a esta salida (se enlaza al facturar).';
comment on column public.stock_movements.reason is
  'Motivo libre del movimiento o motivo del ajuste de inventario (rotura, robo, error de carga…).';

-- Refrescar PostgREST schema cache para que vea las nuevas tablas/columnas
notify pgrst, 'reload schema';
