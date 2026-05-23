-- =============================================================================
-- 20260523120000_maintenance_jobs_indices.sql
-- Índices defensivos para soportar empresas con 1000+ mantenimientos al año
-- sin degradar las consultas de agenda y la cola por confirmar.
-- =============================================================================

-- 1) Listado /agenda y cola por confirmar filtran por status + scheduled_at.
--    El índice existente (idx_mj_scheduled) cubre (company_id, scheduled_at)
--    sin status — degrada cuando crece el histórico de completados. Añadimos
--    uno que incluye status como leading column tras company_id.
create index if not exists idx_mj_company_status_sched
  on public.maintenance_jobs (company_id, status, scheduled_at);

-- 2) Para la sub-query "último mantenimiento completado por contrato" en
--    listMaintenanceToConfirm.
create index if not exists idx_mj_contract_completed_at
  on public.maintenance_jobs (contract_id, completed_at desc)
  where status = 'completed' and completed_at is not null;

notify pgrst, 'reload schema';
