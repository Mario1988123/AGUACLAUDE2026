-- =============================================================================
-- 20260604100900_product_filters.sql
-- Fase 1 del Plan Productos v2.
-- Filtros y recambios consumibles como entidad SEPARADA de `products`.
-- Razón: un filtro no necesita ficha técnica completa con 30 atributos,
-- ni planes de precio renting/alquiler. Vive en su propia tabla simple
-- con stock + asignación a equipos + compatibilidades.
--
-- Tablas:
--   - product_filters                 catálogo de filtros (uno por SKU)
--   - product_filter_assignments      N:N filtro ↔ equipo (con etapa y periodicidad)
--   - product_filter_compatibilities  filtros equivalentes (si falta A, vale B)
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'product_filter_type') then
    create type app.product_filter_type as enum (
      'sediment',         -- sedimentos (polipropileno melt-blown, hilo, plisado)
      'gac',              -- carbón activo granular
      'cto',              -- carbón en bloque (chlorine, taste, odor)
      'membrane',         -- membrana de ósmosis inversa
      'postcarbon',       -- post-filtro de carbón (suele inline)
      'remineralizer',    -- remineralizador
      'softener_resin',   -- resina catiónica de descalcificador
      'uv_lamp',          -- lámpara UV
      'uf',               -- ultrafiltración
      'other'
    );
  end if;
end $$;

-- =============================================================================
-- product_filters: cada filtro/recambio del catálogo
-- =============================================================================

create table if not exists public.product_filters (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,

  -- Identificación
  name                        text not null,
  internal_reference          text,                              -- nuestro SKU
  supplier_reference          text,                              -- ref proveedor
  manufacturer_name           text,
  manufacturer_model          text,
  barcode_ean13               text,

  -- Tipo
  filter_type                 app.product_filter_type not null default 'other',

  -- Especificaciones mínimas (no ficha técnica, solo lo imprescindible para
  -- decidir qué filtro toca cambiar)
  micron_rating               numeric(6,2),                      -- µm (NULL si no aplica: ej. membrana)
  size_inches                 text,                              -- "10\"", "20\"", "Big Blue 10\"", "1812", "2012"
  connection_inches           text,                              -- "1/4\"", "3/8\"", "1/2\""
  capacity_liters             integer,                           -- capacidad nominal tratado
  lifespan_months             integer,                           -- vida útil estimada por defecto

  -- Stock & coste (mismo régimen que `products`)
  cost_cents                  integer check (cost_cents is null or cost_cents >= 0),
  sale_price_cents            integer check (sale_price_cents is null or sale_price_cents >= 0),
  stock_managed               boolean not null default true,
  stock_min                   integer not null default 0,
  stock_max                   integer,
  supplier_lead_time_days     integer,

  -- Visual
  main_image_url              text,

  -- Estado
  is_active                   boolean not null default true,
  notes                       text,

  -- Auditoría
  created_at                  timestamptz not null default now(),
  created_by                  uuid references auth.users(id) on delete set null,
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,

  unique (company_id, internal_reference) deferrable initially deferred
);

create index if not exists idx_pf_company on public.product_filters(company_id) where deleted_at is null;
create index if not exists idx_pf_type on public.product_filters(company_id, filter_type) where deleted_at is null;
create index if not exists idx_pf_active on public.product_filters(company_id, is_active) where deleted_at is null;
create index if not exists idx_pf_barcode on public.product_filters(company_id, barcode_ean13)
  where barcode_ean13 is not null and deleted_at is null;

create trigger trg_pf_updated
  before update on public.product_filters
  for each row execute function app.set_updated_at();

comment on table public.product_filters is
  'Catálogo de filtros y recambios consumibles. Separado de products: no llevan ficha técnica completa ni planes de precio renting. Stock + coste igual que productos.';

-- =============================================================================
-- product_filter_assignments: qué filtros lleva cada equipo, con etapa
-- y periodicidad de cambio. Necesaria para stock predictivo.
-- =============================================================================

create table if not exists public.product_filter_assignments (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  product_id                  uuid not null references public.products(id) on delete cascade,
  filter_id                   uuid not null references public.product_filters(id) on delete restrict,
  stage_position              integer,                           -- etapa 1, 2, 3... dentro del equipo
  replacement_period_months   integer,                           -- sobreescribe lifespan_months del filtro si presente
  is_required                 boolean not null default true,     -- si false: opcional / a demanda
  quantity_per_change         integer not null default 1,
  notes                       text,
  created_at                  timestamptz not null default now(),
  created_by                  uuid references auth.users(id) on delete set null,
  unique (product_id, filter_id)
);

create index if not exists idx_pfa_product on public.product_filter_assignments(product_id);
create index if not exists idx_pfa_filter on public.product_filter_assignments(filter_id);
create index if not exists idx_pfa_company on public.product_filter_assignments(company_id);

comment on table public.product_filter_assignments is
  'Filtros que lleva cada equipo. Vincula products.id ↔ product_filters.id. Periodicidad puede sobreescribir la del catálogo del filtro.';

-- =============================================================================
-- product_filter_compatibilities: si no hay stock de A, vale B.
-- Bidireccional (insertar dos filas si la equivalencia es mutua).
-- =============================================================================

create table if not exists public.product_filter_compatibilities (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  filter_a_id     uuid not null references public.product_filters(id) on delete cascade,
  filter_b_id     uuid not null references public.product_filters(id) on delete cascade,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  unique (filter_a_id, filter_b_id),
  check (filter_a_id <> filter_b_id)
);

create index if not exists idx_pfc_a on public.product_filter_compatibilities(filter_a_id);
create index if not exists idx_pfc_b on public.product_filter_compatibilities(filter_b_id);

comment on table public.product_filter_compatibilities is
  'Filtros intercambiables. Si falta stock de A, el equipo acepta B. Bidireccional vía 2 filas.';

-- =============================================================================
-- RLS — sigue las reglas de permisos del módulo Productos:
--   - Nivel 1 (admin) gestiona TODO.
--   - Nivel 2 y 3 leen.
-- =============================================================================

do $$
declare t text;
begin
  for t in select unnest(array[
    'product_filters', 'product_filter_assignments', 'product_filter_compatibilities'
  ]::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())',
      t || '_super', t
    );

    -- Cualquier usuario autenticado de la empresa lee.
    execute format('drop policy if exists %I on public.%I', t || '_select_tenant', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id = app.current_company_id())',
      t || '_select_tenant', t
    );

    -- Solo admin escribe.
    execute format('drop policy if exists %I on public.%I', t || '_admin_manage', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id() and app.has_role(''company_admin'')) with check (company_id = app.current_company_id() and app.has_role(''company_admin''))',
      t || '_admin_manage', t
    );
  end loop;
end $$;

notify pgrst, 'reload schema';
