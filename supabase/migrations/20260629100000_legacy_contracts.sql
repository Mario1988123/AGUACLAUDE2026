-- =============================================================================
-- Fase C — contratos heredados (migración Infinity Aqua). Aditivo + idempotente.
-- =============================================================================

-- "Factura desde": el cron de cuotas mensuales NO factura un contrato antes de
-- esta fecha. Para los alquileres heredados la ponemos al 1º del mes siguiente
-- → cobro desde el próximo mes, sin atrasados ni doble-cobro del mes en curso.
alter table public.contracts add column if not exists billing_starts_at date;

-- Marca de contrato heredado (creado por la migración, no firmado en el CRM).
alter table public.contracts add column if not exists is_legacy boolean not null default false;

-- Equipo de origen del contrato heredado (1 contrato por equipo). Sirve para
-- idempotencia: no generar dos veces el contrato del mismo equipo.
alter table public.contracts
  add column if not exists source_equipment_id uuid references public.customer_equipment(id) on delete set null;

create index if not exists idx_contracts_source_equipment
  on public.contracts(source_equipment_id) where source_equipment_id is not null;
