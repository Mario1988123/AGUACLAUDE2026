-- =============================================================================
-- 20260626100000_points_ledger_metadata.sql
-- Añade metadata jsonb a points_ledger para soportar los HITOS mensuales.
--
-- POR QUÉ: checkAndAwardMilestones insertaba subject_type/subject_id/metadata
-- (columnas que NO existían en points_ledger) → el INSERT fallaba y los bonus
-- de hito NUNCA se otorgaban. En vez de meter un id sintético en una columna
-- uuid, guardamos la clave del hito (year-month-threshold) en metadata y
-- deduplicamos por ahí, dejando reason='milestone_reached' intacto (los labels
-- y otros filtros lo siguen reconociendo).
--
-- Aditivo y idempotente.
-- =============================================================================

alter table public.points_ledger
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Índice para deduplicar hitos por clave dentro del periodo (consulta del cron
-- y de getMyMilestones). Parcial: solo filas de hito.
create index if not exists idx_pl_milestone_key
  on public.points_ledger ((metadata->>'milestone_key'))
  where reason = 'milestone_reached';
