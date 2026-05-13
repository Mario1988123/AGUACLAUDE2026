-- ============================================================================
-- Fase 1 modelo precios duales + toggle autónomo
-- ----------------------------------------------------------------------------
-- 1) `customers.is_autonomo` y `leads.is_autonomo`:
--    Toggle informativo cuando party_kind='company'. Significa que la
--    persona/empresa tributa como autónomo. A efectos de aplicación de
--    precios e IVA se trata como "empresa" (base + IVA), pero el módulo
--    de financieras lo distingue para saber qué financiera puede
--    ofrecer el plan renting.
--
-- 2) `product_pricing_plans` recibe 5 columnas nuevas para guardar dos
--    precios independientes (particular vs empresa/autónomo). El campo
--    legacy (`monthly_price_cents`, `total_price_cents`,
--    `financier_payment_cents`) se mantiene por retro-compatibilidad y
--    se rellena con el valor "individual" — el código viejo seguirá
--    leyéndolo hasta que se migre completamente.
--
--    Modelo:
--      _individual_cents = lo que paga el PARTICULAR (IVA incluido)
--      _business_cents   = BASE para empresa/autónomo (se suma IVA al
--                          mostrar / facturar)
--
-- 3) Backfill: copiar los precios existentes a la versión "individual"
--    (asumimos que los precios cargados hoy son particulares con IVA).
--    `_business_cents` queda en NULL para que el admin los rellene.
-- ============================================================================

-- 1) Toggle autónomo en customers y leads.
alter table public.customers
  add column if not exists is_autonomo boolean not null default false;
comment on column public.customers.is_autonomo is
  'true si el cliente tributa como autónomo (persona física con actividad económica). Se trata como empresa a efectos de precio+IVA y filtra qué financieras pueden ofrecerse en renting.';

alter table public.leads
  add column if not exists is_autonomo boolean not null default false;
comment on column public.leads.is_autonomo is
  'idem customers.is_autonomo — para filtrar financieras y aplicar precio empresa al convertir.';

-- 2) Doble precio en product_pricing_plans.
alter table public.product_pricing_plans
  add column if not exists monthly_price_individual_cents      integer
    check (monthly_price_individual_cents is null or monthly_price_individual_cents >= 0),
  add column if not exists monthly_price_business_cents        integer
    check (monthly_price_business_cents is null or monthly_price_business_cents >= 0),
  add column if not exists total_price_individual_cents        integer
    check (total_price_individual_cents is null or total_price_individual_cents >= 0),
  add column if not exists total_price_business_cents          integer
    check (total_price_business_cents is null or total_price_business_cents >= 0),
  add column if not exists financier_payment_business_cents    integer
    check (financier_payment_business_cents is null or financier_payment_business_cents >= 0);

comment on column public.product_pricing_plans.monthly_price_individual_cents is
  'Cuota mensual para PARTICULAR — IVA incluido. Lo que paga al mes.';
comment on column public.product_pricing_plans.monthly_price_business_cents is
  'Cuota mensual para EMPRESA o AUTÓNOMO — BASE imponible. En la propuesta y factura se suma IVA encima.';
comment on column public.product_pricing_plans.total_price_individual_cents is
  'Precio total para PARTICULAR — IVA incluido (cash) o monthly_individual × duration (renting/rental).';
comment on column public.product_pricing_plans.total_price_business_cents is
  'Precio total para EMPRESA / AUTÓNOMO — BASE imponible.';
comment on column public.product_pricing_plans.financier_payment_business_cents is
  'Capital que percibe la EMPRESA de la financiera (base, sin IVA) cuando el cliente es empresa/autónomo. El financier_payment_cents legacy se mantiene como "individual".';

-- 3) Backfill: copiar a la versión "individual" si está vacía.
update public.product_pricing_plans
   set monthly_price_individual_cents = monthly_price_cents
 where monthly_price_individual_cents is null
   and monthly_price_cents is not null;

update public.product_pricing_plans
   set total_price_individual_cents = total_price_cents
 where total_price_individual_cents is null
   and total_price_cents is not null;

update public.product_pricing_plans
   set financier_payment_business_cents = financier_payment_cents
 where financier_payment_business_cents is null
   and financier_payment_cents is not null;

notify pgrst, 'reload schema';
