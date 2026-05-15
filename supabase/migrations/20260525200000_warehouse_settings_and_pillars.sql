-- =============================================================================
-- 20260525200000_warehouse_settings_and_pillars.sql
-- Configuración de almacenes (pilar A) + tablas para pilares B/C/D/E/F/G.
--
-- A) warehouse_settings: política de alertas y valoración por empresa.
-- B) stock_lots: lotes FIFO sin caducidad (orden recepción).
-- C) products.barcode: barcode del fabricante para escaneo.
-- D) purchase_suggestions: sugerencias acumulables de pedido al proveedor.
-- E) stock_counts + stock_count_items: conteos físicos cíclicos.
-- F) Trazabilidad SN: ya existe en customer_equipment.serial_number.
-- =============================================================================

-- ===== A) WAREHOUSE_SETTINGS =====
create table if not exists public.warehouse_settings (
  company_id                  uuid primary key references public.companies(id) on delete cascade,
  /** Método valoración del inventario: PMP (promedio ponderado) | FIFO */
  valuation_method            text not null default 'PMP'
    check (valuation_method in ('PMP','FIFO')),
  /** Días para considerar "sin rotación". Default 90. */
  alert_no_rotation_days      integer not null default 90 check (alert_no_rotation_days > 0),
  /** Edad mínima de la empresa para empezar a generar alertas de rotación.
   *  Evita falsos positivos en empresas recién creadas. */
  alert_min_company_age_days  integer not null default 90 check (alert_min_company_age_days >= 0),
  /** Diccionario JSON con cuáles alertas están activas. */
  alerts_enabled              jsonb not null default jsonb_build_object(
    'below_min', true,
    'predictive_low', true,
    'over_max', true,
    'no_rotation_90d', true,
    'no_lead_time_set', true
  ),
  /** IVA por defecto al crear movimientos de entrada (compras). */
  default_iva_pct             numeric(5,2) not null default 21.00,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create trigger trg_warehouse_settings_updated
  before update on public.warehouse_settings
  for each row execute function app.set_updated_at();

alter table public.warehouse_settings enable row level security;

drop policy if exists ws_super on public.warehouse_settings;
create policy ws_super on public.warehouse_settings
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists ws_select on public.warehouse_settings;
create policy ws_select on public.warehouse_settings
  for select to authenticated using (company_id = app.current_company_id());

drop policy if exists ws_admin_manage on public.warehouse_settings;
create policy ws_admin_manage on public.warehouse_settings
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in ('company_admin','technical_director')
         and ur.revoked_at is null
    )
  )
  with check (company_id = app.current_company_id());

-- ===== B) STOCK LOTS (FIFO sin caducidad) =====
create table if not exists public.stock_lots (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  lot_code        text,
  received_at     timestamptz not null default now(),
  initial_quantity numeric(12,3) not null check (initial_quantity > 0),
  remaining_quantity numeric(12,3) not null check (remaining_quantity >= 0),
  unit_cost_cents integer,
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_lots_product_wh_fifo
  on public.stock_lots(product_id, warehouse_id, received_at)
  where remaining_quantity > 0;
create index if not exists idx_lots_company on public.stock_lots(company_id);

comment on table public.stock_lots is
  'Lotes de stock para FIFO. No tienen caducidad (los productos de agua no caducan, pero se recomienda usar el más antiguo).';

alter table public.stock_lots enable row level security;

drop policy if exists sl_super on public.stock_lots;
create policy sl_super on public.stock_lots
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists sl_select on public.stock_lots;
create policy sl_select on public.stock_lots
  for select to authenticated using (company_id = app.current_company_id());

drop policy if exists sl_manage on public.stock_lots;
create policy sl_manage on public.stock_lots
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in ('company_admin','technical_director','installer')
         and ur.revoked_at is null
    )
  )
  with check (company_id = app.current_company_id());

-- ===== C) PRODUCTS.BARCODE =====
alter table public.products
  add column if not exists barcode text;
create index if not exists idx_products_barcode on public.products(company_id, barcode)
  where barcode is not null;

-- Movimientos referencian lote si aplica
alter table public.stock_movements
  add column if not exists lot_id uuid references public.stock_lots(id) on delete set null;
create index if not exists idx_movements_lot on public.stock_movements(lot_id)
  where lot_id is not null;

-- ===== D) PURCHASE SUGGESTIONS (acumulables) =====
create table if not exists public.purchase_suggestions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete cascade,
  /** Cantidad sugerida por el cálculo del cron (stock_max - actual + safety). */
  suggested_qty       numeric(12,3) not null check (suggested_qty > 0),
  /** Cantidad que admin ha ajustado a mano (puede acumular varias rondas). */
  approved_qty        numeric(12,3),
  reason              text,
  status              text not null default 'pending'
    check (status in ('pending','approved','dismissed','ordered')),
  /** Si fue agrupada en una compra concreta, referencia. */
  purchase_id         uuid references public.purchases(id) on delete set null,
  reviewed_by         uuid references auth.users(id) on delete set null,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_psug_company_status
  on public.purchase_suggestions(company_id, status, created_at desc);

create trigger trg_psug_updated
  before update on public.purchase_suggestions
  for each row execute function app.set_updated_at();

comment on table public.purchase_suggestions is
  'Sugerencias acumulables de pedido. Admin agrupa varias para cumplir mínimo del proveedor.';

alter table public.purchase_suggestions enable row level security;

drop policy if exists psug_super on public.purchase_suggestions;
create policy psug_super on public.purchase_suggestions
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists psug_select on public.purchase_suggestions;
create policy psug_select on public.purchase_suggestions
  for select to authenticated using (company_id = app.current_company_id());

drop policy if exists psug_manage on public.purchase_suggestions;
create policy psug_manage on public.purchase_suggestions
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in ('company_admin','technical_director')
         and ur.revoked_at is null
    )
  )
  with check (company_id = app.current_company_id());

-- ===== E) STOCK COUNTS (conteo cíclico) =====
create table if not exists public.stock_counts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete cascade,
  label           text not null,
  status          text not null default 'open'
    check (status in ('open','completed','cancelled')),
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  started_by      uuid references auth.users(id) on delete set null,
  completed_by    uuid references auth.users(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_counts_warehouse_status
  on public.stock_counts(warehouse_id, status, started_at desc);

create table if not exists public.stock_count_items (
  id              uuid primary key default gen_random_uuid(),
  count_id        uuid not null references public.stock_counts(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  expected_qty    numeric(12,3) not null,
  counted_qty     numeric(12,3),
  diff            numeric(12,3),
  notes           text,
  counted_at      timestamptz,
  counted_by      uuid references auth.users(id) on delete set null,
  unique (count_id, product_id)
);

alter table public.stock_counts enable row level security;
alter table public.stock_count_items enable row level security;

drop policy if exists sc_super on public.stock_counts;
create policy sc_super on public.stock_counts
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists sc_select on public.stock_counts;
create policy sc_select on public.stock_counts
  for select to authenticated using (company_id = app.current_company_id());

drop policy if exists sc_manage on public.stock_counts;
create policy sc_manage on public.stock_counts
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in ('company_admin','technical_director','installer')
         and ur.revoked_at is null
    )
  )
  with check (company_id = app.current_company_id());

drop policy if exists sci_super on public.stock_count_items;
create policy sci_super on public.stock_count_items
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists sci_all on public.stock_count_items;
create policy sci_all on public.stock_count_items
  for all to authenticated
  using (
    exists (
      select 1 from public.stock_counts sc
       where sc.id = stock_count_items.count_id
         and sc.company_id = app.current_company_id()
    )
  );

notify pgrst, 'reload schema';
