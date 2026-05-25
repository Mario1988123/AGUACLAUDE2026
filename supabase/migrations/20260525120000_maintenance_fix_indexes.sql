-- =============================================================================
-- 20260525120000_maintenance_fix_indexes.sql
-- Crea los índices parciales que dependen de los valores 'preprogrammed'
-- y 'needs_callback' del enum app.maintenance_status. Postgres exige
-- que los nuevos valores de enum estén COMMITED en una transacción
-- anterior antes de poder usarlos en expresiones de índice. Por eso
-- esto va en un fichero separado de las migraciones que los añadieron
-- (20260525100000 y 20260525110000).
-- Idempotente con `if not exists` + `drop ... if exists` para tolerar
-- estados previos parciales.
-- =============================================================================

-- Idempotencia: limpiamos por si quedaron creados a medias en intentos
-- anteriores
drop index if exists public.idx_mjobs_pending_confirm;
drop index if exists public.idx_mjobs_needs_callback;

-- Cola "por confirmar": preprogrammed sin confirmed_at
create index if not exists idx_mjobs_pending_confirm
  on public.maintenance_jobs (company_id, scheduled_at)
  where status = 'preprogrammed' and confirmed_at is null;

-- Cola "necesitan llamada": clientes que pospusieron desde el email
create index if not exists idx_mjobs_needs_callback
  on public.maintenance_jobs (company_id, scheduled_at)
  where status = 'needs_callback';

notify pgrst, 'reload schema';
