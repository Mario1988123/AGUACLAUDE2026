-- =============================================================================
-- 20260502120000_contract_service_start_date.sql
-- Añade service_start_date al contrato — fecha en que el servicio empieza a
-- contar (puede ser distinta de la fecha de instalación). De ella derivan los
-- ciclos de cobro mensual y las fechas de los mantenimientos programados.
-- =============================================================================

alter table public.contracts
  add column if not exists service_start_date date;

comment on column public.contracts.service_start_date is
  'Fecha de inicio del servicio. Si es futura, el contrato queda en signed y se activa por el cron diario al llegar el día.';
