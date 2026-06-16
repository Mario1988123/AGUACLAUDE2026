-- =============================================================================
-- Importación clientes (Infinity Aqua / CRM antiguo) — campos nuevos
-- Decisiones Mario 2026-06-16. Todo aditivo + idempotente.
-- =============================================================================

-- 1) Código externo: el nº de cliente del sistema antiguo (ej. "CL-121374").
--    Se respeta y sirve para dedupe/upsert: reimportar NO duplica, casa por
--    (company_id, external_code) y completa lo que falte.
alter table public.customers add column if not exists external_code text;

-- Único por empresa (un código = un cliente). Parcial: ignora los null
-- (clientes que no vienen de importación). Si hubiera choque, el upsert lo evita.
create unique index if not exists uq_customers_external_code
  on public.customers(company_id, external_code)
  where external_code is not null;

-- 2) Modalidad heredada POR EQUIPO (Fase 1 del volcado: se guarda como DATO,
--    el contrato real se genera en la Fase 2).
--      acquisition_type: 'cash' (venta) | 'rental' (alquiler) | 'renting'
alter table public.customer_equipment
  add column if not exists acquisition_type text;
alter table public.customer_equipment
  add column if not exists acquisition_amount_cents integer;   -- cuota €/mes (alquiler/renting) o precio venta, en céntimos
alter table public.customer_equipment
  add column if not exists acquisition_started_at date;        -- fecha de inicio del contrato heredado
