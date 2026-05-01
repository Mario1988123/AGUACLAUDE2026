-- =============================================================================
-- 20260501121100_products.sql
-- Capa 2 · Módulo Productos completo.
--
-- Tablas:
--   - product_categories_global         catálogo del superadmin (precargable)
--   - product_categories                locales por empresa (clonadas/propias)
--   - product_attributes_global         atributos catalogados (precargable)
--   - product_attributes                atributos locales por empresa
--   - external_equipment_models         modelos de equipos de competencia
--   - products                          productos de la empresa
--   - product_pricing_plans             planes de precio (cash/renting/rental)
--   - product_attribute_values          M:N producto -> atributo + valor
--   - product_images                    galería de imágenes
--   - product_compatibilities           N:N entre nuestros productos (recambios)
--   - product_external_compatibilities  N:N producto recambio <-> modelo competencia
-- =============================================================================

-- -----------------------------------------------------------------------------
-- enums
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'product_kind') then
    create type app.product_kind as enum (
      'equipment',     -- equipo principal (osmosis, dispensador, etc.)
      'spare_part',    -- recambio (filtro, membrana, etc.)
      'accessory',     -- accesorio
      'consumable',    -- consumible (sal, gel, etc.)
      'service'        -- servicio (instalación, transporte, mano de obra)
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'pricing_plan_type') then
    create type app.pricing_plan_type as enum ('cash','renting','rental');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'attribute_data_type') then
    create type app.attribute_data_type as enum (
      'text','number','boolean','enum','dimension','date'
    );
  end if;
end $$;

-- =============================================================================
-- CATÁLOGO GLOBAL (superadmin)
-- =============================================================================

create table public.product_categories_global (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,                              -- "osmosis", "dispensers", ...
  parent_key      text references public.product_categories_global(key) on delete set null,
  name_es         text not null,
  description_es  text,
  default_kind    app.product_kind not null default 'equipment',
  icon            text,
  sort_order      integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create index idx_pcg_parent on public.product_categories_global(parent_key);

create table public.product_attributes_global (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,                              -- "membrane_type", "flow_lpm", ...
  name_es         text not null,
  description_es  text,
  data_type       app.attribute_data_type not null default 'text',
  unit            text,                                              -- "L/min", "bar", "kg", ...
  enum_values     text[],                                            -- solo si data_type = 'enum'
  default_visible boolean not null default true,
  sort_order      integer not null default 0
);

-- Atributo aplicable a categoría: define qué atributos aparecen en cada categoría
create table public.product_attributes_global_categories (
  attribute_key   text not null references public.product_attributes_global(key) on delete cascade,
  category_key    text not null references public.product_categories_global(key) on delete cascade,
  is_required     boolean not null default false,
  primary key (attribute_key, category_key)
);

-- =============================================================================
-- CATÁLOGO LOCAL (empresa)
-- =============================================================================

create table public.product_categories (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  cloned_from_global_id uuid references public.product_categories_global(id) on delete set null,
  parent_id           uuid references public.product_categories(id) on delete set null,
  name                text not null,
  description         text,
  default_kind        app.product_kind not null default 'equipment',
  icon                text,
  sort_order          integer not null default 0,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  unique (company_id, name)
);

create index idx_pc_company on public.product_categories(company_id);
create index idx_pc_parent on public.product_categories(parent_id);

create table public.product_attributes (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  cloned_from_global_id   uuid references public.product_attributes_global(id) on delete set null,
  category_id             uuid references public.product_categories(id) on delete set null,
  key                     text not null,                              -- snake_case dentro de la empresa
  name                    text not null,
  description             text,
  data_type               app.attribute_data_type not null default 'text',
  unit                    text,
  enum_values             text[],
  default_visible         boolean not null default true,
  is_required             boolean not null default false,
  sort_order              integer not null default 0,
  created_at              timestamptz not null default now(),
  unique (company_id, category_id, key)
);

create index idx_pa_company_category on public.product_attributes(company_id, category_id);

-- =============================================================================
-- EQUIPOS DE COMPETENCIA (para mantenimientos a equipos no nuestros)
-- =============================================================================

create table public.external_equipment_models (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete cascade,   -- null = catálogo global superadmin
  brand         text not null,
  model         text not null,
  category_id   uuid references public.product_categories(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (company_id, brand, model)
);

create index idx_eem_company on public.external_equipment_models(company_id);

-- =============================================================================
-- PRODUCTS
-- =============================================================================

create table public.products (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  category_id                 uuid references public.product_categories(id) on delete set null,
  kind                        app.product_kind not null default 'equipment',

  -- Datos básicos
  name                        text not null,
  short_description           text,
  long_description            text,
  supplier_reference          text,                                   -- ref del proveedor
  internal_reference          text,                                   -- nuestra ref / SKU

  -- Estado
  is_active                   boolean not null default true,

  -- Imagen principal (denormalizada para listings rápidos)
  main_image_url              text,

  -- Costes y márgenes (CAMPOS SENSIBLES — solo company_admin via field_restrictions)
  cost_cents                  integer check (cost_cents is null or cost_cents >= 0),
  supplier_price_cents        integer check (supplier_price_cents is null or supplier_price_cents >= 0),
  margin_cents                integer,                                -- calculado si quieres, o manual

  -- Dimensiones (mm) — obligatorias para ficha técnica con dibujo 3D
  dim_width_mm                integer check (dim_width_mm is null or dim_width_mm > 0),
  dim_height_mm               integer check (dim_height_mm is null or dim_height_mm > 0),
  dim_depth_mm                integer check (dim_depth_mm is null or dim_depth_mm > 0),
  weight_grams                integer check (weight_grams is null or weight_grams > 0),

  -- Stock — config (los movimientos van en warehouses module)
  stock_managed               boolean not null default true,
  stock_min                   integer not null default 0 check (stock_min >= 0),
  stock_max                   integer,
  stock_reorder_qty           integer,
  supplier_lead_time_days     integer,
  monthly_consumption_avg     numeric(10,2),                          -- calculado por trigger
  low_stock_warning_threshold integer,                                -- alerta antes del mínimo

  -- Notas
  notes                       text,

  -- Auditoría
  created_at                  timestamptz not null default now(),
  created_by                  uuid references auth.users(id) on delete set null,
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,                            -- soft-delete

  unique (company_id, internal_reference) deferrable initially deferred
);

create index idx_products_company on public.products(company_id) where deleted_at is null;
create index idx_products_category on public.products(company_id, category_id) where deleted_at is null;
create index idx_products_kind on public.products(company_id, kind) where deleted_at is null;
create index idx_products_active on public.products(company_id, is_active) where deleted_at is null;
create index idx_products_search on public.products using gin (to_tsvector('spanish', coalesce(name,'') || ' ' || coalesce(short_description,''))) where deleted_at is null;

create trigger trg_products_updated
  before update on public.products
  for each row execute function app.set_updated_at();

comment on table public.products is
  'Productos de la empresa. Recambios = kind=spare_part. Costes/márgenes solo visibles a admin.';

-- =============================================================================
-- product_pricing_plans
-- Cada producto puede tener múltiples planes (contado + renting 36m +
-- renting 48m + alquiler 12m, etc.).
-- =============================================================================

create table public.product_pricing_plans (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  product_id              uuid not null references public.products(id) on delete cascade,
  plan_type               app.pricing_plan_type not null,

  -- Para renting/rental: duración en meses. NULL para cash.
  duration_months         integer check (duration_months is null or duration_months > 0),

  -- Precio mensual (cuota). Para cash, este campo = total_price_cents y duration_months = NULL.
  monthly_price_cents     integer check (monthly_price_cents is null or monthly_price_cents >= 0),

  -- Total al cliente (calculado: monthly * duration en renting/rental, o PVP en cash)
  total_price_cents       integer not null check (total_price_cents >= 0),

  -- Renting financiera
  financing_coefficient   numeric(8,6),                                -- ej. 0.02375
  financier_payment_cents integer,                                     -- cuota / coeficiente

  -- Alquiler / renting permanencia
  permanence_months       integer,

  -- Mínimos por nivel (decisión 1.6)
  -- Nivel 3 puede vender hasta este precio sin pedir aprobación.
  min_authorized_cents    integer not null check (min_authorized_cents >= 0),
  -- Mínimo absoluto (requiere aprobación nivel 1/2). NUNCA visible a sales_rep.
  absolute_min_cents      integer not null check (absolute_min_cents >= 0),

  -- Estado
  is_active               boolean not null default true,
  display_order           integer not null default 0,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  check (absolute_min_cents <= min_authorized_cents),
  check (min_authorized_cents <= total_price_cents),
  -- En cash, duration_months debe ser NULL
  check ((plan_type = 'cash' and duration_months is null) or (plan_type <> 'cash' and duration_months > 0))
);

create index idx_ppp_product on public.product_pricing_plans(product_id) where is_active = true;
create index idx_ppp_company_type on public.product_pricing_plans(company_id, plan_type);

create trigger trg_ppp_updated
  before update on public.product_pricing_plans
  for each row execute function app.set_updated_at();

comment on table public.product_pricing_plans is
  'Planes de precio por producto. Un producto suele tener 1 cash + N renting + 1 alquiler.';

-- =============================================================================
-- product_attribute_values
-- =============================================================================

create table public.product_attribute_values (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references public.products(id) on delete cascade,
  attribute_id        uuid not null references public.product_attributes(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  -- Valor según data_type del atributo (almacenamos como text + jsonb por flexibilidad)
  value_text          text,
  value_number        numeric,
  value_boolean       boolean,
  value_json          jsonb,
  -- Visibilidad: el toggle "mostrar este atributo en este producto"
  is_visible          boolean not null default true,
  is_featured         boolean not null default false,
  featured_icon_url   text,
  display_order       integer not null default 0,
  unique (product_id, attribute_id)
);

create index idx_pav_product on public.product_attribute_values(product_id);
create index idx_pav_featured on public.product_attribute_values(product_id) where is_featured = true;

comment on table public.product_attribute_values is
  'Valores de atributos por producto. Toggle is_visible y máximo 5 destacados (validar en app).';

-- =============================================================================
-- product_images
-- =============================================================================

create table public.product_images (
  id              uuid primary key default gen_random_uuid(),
  product_id      uuid not null references public.products(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  storage_path    text not null,
  alt_text        text,
  is_main         boolean not null default false,
  display_order   integer not null default 0,
  width_px        integer,
  height_px       integer,
  uploaded_at     timestamptz not null default now(),
  uploaded_by     uuid references auth.users(id) on delete set null
);

create index idx_pi_product on public.product_images(product_id);
create unique index uniq_pi_main_per_product on public.product_images(product_id) where is_main = true;

-- =============================================================================
-- product_compatibilities (recambio compatible con producto principal)
-- Bidireccional: si un filtro encaja con osmosis A y B, dos filas.
-- =============================================================================

create table public.product_compatibilities (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies(id) on delete cascade,
  spare_part_product_id   uuid not null references public.products(id) on delete cascade,
  equipment_product_id    uuid not null references public.products(id) on delete cascade,
  notes                   text,
  created_at              timestamptz not null default now(),
  unique (spare_part_product_id, equipment_product_id),
  check (spare_part_product_id <> equipment_product_id)
);

create index idx_pcompat_spare on public.product_compatibilities(spare_part_product_id);
create index idx_pcompat_equipment on public.product_compatibilities(equipment_product_id);

create table public.product_external_compatibilities (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  spare_part_product_id       uuid not null references public.products(id) on delete cascade,
  external_equipment_model_id uuid not null references public.external_equipment_models(id) on delete cascade,
  notes                       text,
  created_at                  timestamptz not null default now(),
  unique (spare_part_product_id, external_equipment_model_id)
);

create index idx_pec_spare on public.product_external_compatibilities(spare_part_product_id);

-- =============================================================================
-- RLS
-- =============================================================================

-- Catálogos globales: lectura authenticated, escritura solo superadmin
alter table public.product_categories_global enable row level security;
drop policy if exists pcg_read on public.product_categories_global;
create policy pcg_read on public.product_categories_global for select to authenticated using (true);
drop policy if exists pcg_write_super on public.product_categories_global;
create policy pcg_write_super on public.product_categories_global for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

alter table public.product_attributes_global enable row level security;
drop policy if exists pag_read on public.product_attributes_global;
create policy pag_read on public.product_attributes_global for select to authenticated using (true);
drop policy if exists pag_write_super on public.product_attributes_global;
create policy pag_write_super on public.product_attributes_global for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

alter table public.product_attributes_global_categories enable row level security;
drop policy if exists pagc_read on public.product_attributes_global_categories;
create policy pagc_read on public.product_attributes_global_categories for select to authenticated using (true);
drop policy if exists pagc_write_super on public.product_attributes_global_categories;
create policy pagc_write_super on public.product_attributes_global_categories for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

-- Locales: tenant + admin manage
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'product_categories', 'product_attributes', 'external_equipment_models',
    'products', 'product_pricing_plans', 'product_attribute_values',
    'product_images', 'product_compatibilities', 'product_external_compatibilities'
  ]::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_tenant', t);
    execute format('create policy %I on public.%I for select to authenticated using (company_id = app.current_company_id())', t || '_select_tenant', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_manage', t);
    execute format('create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id() and app.has_role(''company_admin'')) with check (company_id = app.current_company_id() and app.has_role(''company_admin''))', t || '_admin_manage', t);
  end loop;
end $$;

-- external_equipment_models también accesible globalmente cuando company_id is null
drop policy if exists eem_read_global on public.external_equipment_models;
create policy eem_read_global on public.external_equipment_models
  for select to authenticated using (company_id is null);
