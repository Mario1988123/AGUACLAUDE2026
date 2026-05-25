-- =============================================================================
-- 20260525140000_maintenance_contract_per_equipment.sql
-- Permite que un maintenance_contract esté ligado a un equipo concreto
-- del cliente (no solo al cliente). Regla de negocio (decisión usuario
-- 2026-05-25): "el contrato es al equipo no al cliente. puede tener
-- muchos contratos de mantenimiento si tiene muchas máquinas instaladas".
--
-- customer_equipment_id es NULLABLE para retro-compat con contratos
-- creados antes de este cambio (a nivel cliente sin equipo concreto).
-- La UI nueva siempre lo rellena cuando se ofrece desde la ficha del
-- equipo en /clientes/[id].
-- =============================================================================

alter table public.maintenance_contracts
  add column if not exists customer_equipment_id uuid
    references public.customer_equipment(id) on delete set null;

comment on column public.maintenance_contracts.customer_equipment_id is
  'Equipo concreto que cubre este contrato. Un cliente con varios equipos puede tener varios contratos. NULL = contrato legacy a nivel cliente (cubre todos los equipos del cliente).';

-- Índice: la ficha del cliente carga "¿este equipo tiene contrato activo?"
-- y la lista de contratos del equipo. Filtramos siempre por equipo + status.
create index if not exists idx_mcontracts_equipment_status
  on public.maintenance_contracts (customer_equipment_id, status)
  where customer_equipment_id is not null;

notify pgrst, 'reload schema';
