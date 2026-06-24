-- =============================================================================
-- 20260703100000_maintenance_job_address.sql
-- Dirección concreta del mantenimiento (2026-06-24).
--
-- Un cliente puede tener varios equipos en DIRECCIONES distintas
-- (customer_equipment.address_id). Hasta ahora un maintenance_job solo sabía el
-- cliente, así que la agenda/mapa siempre mostraba la dirección PRINCIPAL del
-- cliente aunque el equipo estuviera en otra dirección.
--
-- Añadimos address_id al job para poder fijar DÓNDE se hace el mantenimiento:
--   - Al crearlo con un equipo elegido => por defecto la dirección de ese equipo.
--   - Se puede cambiar a mano a cualquier otra dirección del cliente.
--   - Si queda NULL => se resuelve en lectura como equipo.address_id y, en su
--     defecto, la dirección principal del cliente (compatibilidad hacia atrás).
--
-- ON DELETE SET NULL: si se borra la dirección, el job no se rompe (cae al
-- fallback de equipo/principal).
-- =============================================================================

alter table public.maintenance_jobs
  add column if not exists address_id uuid references public.addresses(id) on delete set null;

comment on column public.maintenance_jobs.address_id is
  'Dirección concreta donde se realiza el mantenimiento. Por defecto la del equipo elegido; editable. NULL = resolver en lectura (equipo.address_id → dirección principal del cliente).';

create index if not exists idx_mjobs_address on public.maintenance_jobs(address_id);

notify pgrst, 'reload schema';
