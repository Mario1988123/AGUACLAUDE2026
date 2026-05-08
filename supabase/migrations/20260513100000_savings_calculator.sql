-- =============================================================================
-- Calculadora de ahorro
-- =============================================================================
-- Inspirado en el legacy WATER_CRM, pero adaptado al schema actual:
-- - REUSA `products` + `product_pricing_plans` (NO duplica tablas calculator_*).
-- - Añade `accepts_extras` y `extra_role` en `product_categories` para que la
--   calculadora sepa cuándo ofrecer extras y dónde agruparlos en el wizard.
-- - Tablas savings_* solo para configuración, marcas de agua y propuestas.
-- - Decisión usuario 2026-05-08: extras opcionales (ningún plan los exige).
-- =============================================================================

-- 1) Categorías: marcas para extras
-- ---------------------------------------------------------------------------
-- accepts_extras = true → los productos de esta categoría (p.ej. ósmosis,
--   flujo directo) podrán llevar extras compatibles.
-- extra_role     = 'tap' | 'cooler' | null → si es categoría de extras
--   (Grifería / Enfriador) se usa para AGRUPAR en el wizard. Si null no es
--   extra.

alter table public.product_categories
  add column if not exists accepts_extras boolean not null default false,
  add column if not exists extra_role text check (extra_role in ('tap', 'cooler'));

alter table public.product_categories_global
  add column if not exists accepts_extras boolean not null default false,
  add column if not exists extra_role text check (extra_role in ('tap', 'cooler'));

create index if not exists idx_pc_accepts_extras
  on public.product_categories(company_id) where accepts_extras = true;
create index if not exists idx_pc_extra_role
  on public.product_categories(company_id, extra_role) where extra_role is not null;

comment on column public.product_categories.accepts_extras is
  'true si los productos de esta categoría admiten añadir extras (ósmosis, flujo directo, etc.). El wizard de la calculadora muestra la sección de extras cuando el principal cae aquí.';
comment on column public.product_categories.extra_role is
  'Rol del extra: tap=grifería, cooler=enfriador, null=no es extra. La calculadora agrupa los extras por este campo.';

-- 2) Configuración de la calculadora por empresa
-- ---------------------------------------------------------------------------
create table if not exists public.savings_calculator_config (
  company_id uuid primary key references public.companies(id) on delete cascade,
  -- Coste anual de mantener una ósmosis ya instalada en casa del cliente
  -- (filtros, electricidad, etc.). Usado cuando el cliente declara que ya
  -- tiene ósmosis pero está pensando en cambiar.
  osmosis_annual_cost_cents integer not null default 15000, -- 150€
  -- Litros/persona/día — hogar
  liters_per_person_day_home numeric(4,2) not null default 2.0,
  -- Litros/persona/día — empresa (oficina)
  liters_per_person_day_office numeric(4,2) not null default 0.5,
  -- Impacto ecológico por botella plástico equivalente (1.5L)
  co2_per_bottle_kg numeric(6,3) not null default 0.082,
  plastic_per_bottle_kg numeric(6,3) not null default 0.025,
  -- Talla de botella estándar para conversión (litros)
  default_bottle_size_liters numeric(3,1) not null default 1.5,
  -- Tamaño de garrafa de servicio (Aquaservice/Culligan) en litros
  service_garrafa_size_liters numeric(4,1) not null default 20,
  -- Frecuencia de reposición de garrafas al año (13 ciclos = mensual + bisiesto)
  service_cycles_per_year integer not null default 13,
  -- Empresas con > N personas → 2 dispensadores recomendados
  recommended_dispensers_threshold integer not null default 15,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.savings_calculator_config enable row level security;

-- 3) Marcas de agua
-- ---------------------------------------------------------------------------
-- Dos modos según `kind`:
--  · supermarket: precio por litro (botellas en supermercado), opcionalmente
--    actualizado por scraper.
--  · service: precio por nº de garrafas/mes (Aquaservice, Culligan…). Manual.
create table if not exists public.savings_water_brands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('supermarket', 'service')),

  -- Si kind='supermarket'
  price_per_liter_cents integer,                     -- ej. 50 = 0.50€/L
  price_source text default 'manual'
    check (price_source in ('manual', 'scraper_mercadona', 'scraper_carrefour')),
  scrape_query text,                                  -- término búsqueda en scraper (ej. "Bezoya 1.5L")
  last_scraped_at timestamptz,
  last_scrape_failed_at timestamptz,
  consecutive_failures integer not null default 0,

  -- Si kind='service' — precios manuales por nº de garrafas/mes
  -- JSONB: { "2": 1590, "3": 2385, "4": 3180, ... } en céntimos
  prices_by_garrafas jsonb,

  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Coherencia: cada kind requiere sus campos
  check (
    (kind = 'supermarket' and price_per_liter_cents is not null) or
    (kind = 'service' and prices_by_garrafas is not null)
  )
);
create index if not exists idx_swb_company_kind
  on public.savings_water_brands(company_id, kind) where is_active = true;
alter table public.savings_water_brands enable row level security;

-- 4) Log de scrapes (auditoría + debug)
-- ---------------------------------------------------------------------------
create table if not exists public.savings_price_scrape_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  brand_id uuid references public.savings_water_brands(id) on delete set null,
  source text not null check (source in ('mercadona', 'carrefour')),
  query text not null,
  found_price_cents integer,
  ok boolean not null default false,
  error_message text,
  raw_response jsonb,
  scraped_at timestamptz not null default now()
);
create index if not exists idx_swsl_company_at
  on public.savings_price_scrape_log(company_id, scraped_at desc);

-- 5) Propuestas guardadas
-- ---------------------------------------------------------------------------
-- Distintas de las propuestas comerciales (proposals) — esta es una
-- "comparativa de ahorro" que el comercial enseña al cliente para
-- convencerle. Si convierte → puede crear una proposal normal a partir
-- de los datos.
create table if not exists public.savings_proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  reference_code text,                  -- "AH-2026-0001"
  customer_id uuid references public.customers(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,

  -- Inputs del wizard
  client_type text not null check (client_type in ('home', 'office')),
  num_people integer not null check (num_people > 0),
  liters_per_person_day numeric(4,2) not null,
  current_service text not null check (current_service in ('osmosis', 'tap', 'bottled', 'service', 'none')),
  current_brand_id uuid references public.savings_water_brands(id) on delete set null,
  current_brand_name_snapshot text,
  current_price_per_liter_cents integer,         -- snapshot
  current_garrafas_per_month integer,            -- si current_service='service'
  current_monthly_cost_cents integer not null,   -- calculado al guardar

  -- Producto principal elegido
  product_id uuid references public.products(id) on delete set null,
  product_name_snapshot text,
  plan_type text not null check (plan_type in ('cash', 'rental', 'renting')),
  duration_months integer,
  product_unit_price_cents integer,
  num_units integer not null default 1,           -- dispensadores recomendados

  -- Extras
  extras jsonb default '[]'::jsonb,                -- [{product_id, name, role:'tap'|'cooler', monthly_cents, install_cents}]

  -- Outputs cacheados
  total_monthly_cost_cents integer not null,
  deposit_cents integer not null default 0,
  payback_months integer,                         -- null si no hay ahorro
  total_saved_5y_cents integer,
  bottles_saved_year integer,
  co2_saved_year_kg numeric(8,2),
  plastic_saved_year_kg numeric(8,2),

  -- Acciones
  pdf_storage_path text,
  sent_by_email_at timestamptz,
  converted_to_proposal_id uuid references public.proposals(id) on delete set null,

  status text not null default 'draft' check (status in ('draft', 'sent', 'converted', 'archived')),
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sp_company on public.savings_proposals(company_id);
create index if not exists idx_sp_customer on public.savings_proposals(customer_id) where customer_id is not null;
create index if not exists idx_sp_lead on public.savings_proposals(lead_id) where lead_id is not null;
alter table public.savings_proposals enable row level security;

-- 6) Trigger updated_at
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_savings_config_updated on public.savings_calculator_config;
create trigger trg_savings_config_updated before update on public.savings_calculator_config
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_savings_brands_updated on public.savings_water_brands;
create trigger trg_savings_brands_updated before update on public.savings_water_brands
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_savings_proposals_updated on public.savings_proposals;
create trigger trg_savings_proposals_updated before update on public.savings_proposals
  for each row execute function public.touch_updated_at();

-- 7) RLS — server actions usan admin client (sin RLS)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'savings_calculator_config',
    'savings_water_brands',
    'savings_price_scrape_log',
    'savings_proposals'
  ]) loop
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())',
      t || '_super', t
    );
  end loop;
end $$;

-- 8) Función helper: sembrar config y marcas por defecto cuando se crea empresa
-- ---------------------------------------------------------------------------
create or replace function public.seed_savings_calculator(p_company uuid)
returns void language plpgsql as $$
begin
  -- Config por defecto
  insert into public.savings_calculator_config (company_id) values (p_company)
  on conflict (company_id) do nothing;

  -- Marcas supermercado (precios orientativos, scraper actualizará)
  insert into public.savings_water_brands (company_id, name, kind, price_per_liter_cents, price_source, scrape_query, display_order)
  values
    (p_company, 'Bezoya', 'supermarket', 50, 'manual', 'Bezoya 1.5L', 1),
    (p_company, 'Font Vella', 'supermarket', 45, 'manual', 'Font Vella 1.5L', 2),
    (p_company, 'Solán de Cabras', 'supermarket', 60, 'manual', 'Solán de Cabras 1.5L', 3),
    (p_company, 'Lanjarón', 'supermarket', 40, 'manual', 'Lanjarón 1.5L', 4),
    (p_company, 'Aquabona', 'supermarket', 35, 'manual', 'Aquabona 1.5L', 5)
  on conflict do nothing;

  -- Servicios
  insert into public.savings_water_brands (company_id, name, kind, prices_by_garrafas, display_order)
  values
    (p_company, 'AquaService', 'service',
      '{"2":1590,"3":2385,"4":3180,"5":3975,"6":4770,"7":5565,"8":6360}'::jsonb, 10),
    (p_company, 'Culligan', 'service',
      '{"2":1750,"3":2625,"4":3500,"5":4375,"6":5250,"7":6125,"8":7000}'::jsonb, 11)
  on conflict do nothing;
end $$;
