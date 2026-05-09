-- =============================================================================
-- Almacenes inteligente — Fase C
-- Compras (albarán/factura proveedor) + devoluciones a proveedor
-- =============================================================================
-- Decisiones usuario 2026-05-09:
--  - Sin tabla suppliers: el proveedor es texto libre en cada compra.
--  - Una compra = un albarán = un almacén destino, con N items.
--  - Cada línea de compra genera un stock_movement (inbound) enlazado.
--  - Devolución a proveedor: nuevo enum value 'outbound_return_supplier'
--    contra el albarán original. Resta stock y queda registrado.
-- =============================================================================

-- 1) Ampliar enum de movimientos para devolución a proveedor
do $$ begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'stock_movement_type' and e.enumlabel = 'outbound_return_supplier'
  ) then
    alter type app.stock_movement_type add value 'outbound_return_supplier';
  end if;
end $$;

-- 2) Tabla de compras (cabecera)
create table if not exists public.purchases (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  warehouse_id        uuid not null references public.warehouses(id) on delete restrict,
  supplier_name       text not null,                       -- texto libre
  supplier_tax_id     text,                                -- opcional
  invoice_number      text not null,                       -- nº albarán/factura proveedor
  invoice_date        date not null,
  total_cents         bigint,                              -- opcional, suma de líneas
  notes               text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_purchases_company_date
  on public.purchases(company_id, invoice_date desc);
create index if not exists idx_purchases_warehouse
  on public.purchases(warehouse_id, invoice_date desc);
create index if not exists idx_purchases_supplier
  on public.purchases(company_id, lower(supplier_name));

drop trigger if exists trg_purchases_updated on public.purchases;
create trigger trg_purchases_updated
  before update on public.purchases
  for each row execute function app.set_updated_at();

-- 3) Líneas de compra
create table if not exists public.purchase_items (
  id                  uuid primary key default gen_random_uuid(),
  purchase_id         uuid not null references public.purchases(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  quantity            integer not null check (quantity > 0),
  -- Coste por unidad para esta compra (puede variar entre compras → CMP en products)
  unit_cost_cents     bigint not null check (unit_cost_cents >= 0),
  notes               text
);

create index if not exists idx_purchase_items_purchase on public.purchase_items(purchase_id);
create index if not exists idx_purchase_items_product on public.purchase_items(company_id, product_id);

-- 4) Cerrar FK forward de stock_movements.purchase_id
do $$ begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where constraint_name = 'sm_purchase_fk'
  ) then
    alter table public.stock_movements
      add constraint sm_purchase_fk
      foreign key (purchase_id) references public.purchases(id) on delete set null;
  end if;
end $$;

-- 5) RLS
do $$
declare t text;
begin
  for t in select unnest(array['purchases','purchase_items']::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_tenant', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = app.current_company_id())', t || '_select_tenant', t);
    execute format('drop policy if exists %I on public.%I', t || '_modify', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id() and (app.has_role(''company_admin'') or app.has_role(''technical_director''))) with check (company_id = app.current_company_id())',
      t || '_modify', t
    );
  end loop;
end $$;

comment on table public.purchases is
  'Albarán/factura de compra al proveedor. Una compra = un almacén destino + N items. Genera entradas (inbound) en stock_movements con purchase_id.';
comment on table public.purchase_items is
  'Línea de compra: producto + cantidad + coste unitario. El coste alimenta el CMP de products.cost_cents.';
