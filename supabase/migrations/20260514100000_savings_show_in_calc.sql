-- =============================================================================
-- Calculadora de ahorro: marcar productos disponibles + planes habilitados
-- =============================================================================
-- Decisiones usuario 2026-05-08:
--  - El admin marca QUÉ productos aparecen en el wizard (no todos).
--  - El admin elige QUÉ planes (cash/rental/renting) están habilitados.
--  - Por defecto, se sugiere una duración renting + cuota orientativa.
-- =============================================================================

-- 1) Flag por producto: ¿se muestra en el wizard de calculadora?
alter table public.products
  add column if not exists show_in_calculator boolean not null default false;

create index if not exists idx_products_show_calc
  on public.products(company_id) where show_in_calculator = true;

comment on column public.products.show_in_calculator is
  'Si true, este producto aparece en el wizard de la calculadora de ahorro. Marca solo los que quieras ofrecer al cliente desde la calculadora.';

-- 2) Config calculadora: planes habilitados + defaults
alter table public.savings_calculator_config
  add column if not exists enabled_plans jsonb not null default
    '{"cash": true, "rental": true, "renting": true}'::jsonb,
  add column if not exists default_renting_duration_months integer default 48,
  add column if not exists default_rental_permanence_months integer default 24;

comment on column public.savings_calculator_config.enabled_plans is
  'Qué planes ofrece la calculadora al comercial. JSONB con keys cash/rental/renting.';
comment on column public.savings_calculator_config.default_renting_duration_months is
  'Duración por defecto al seleccionar Renting en el wizard (12, 24, 36, 48, 60).';
