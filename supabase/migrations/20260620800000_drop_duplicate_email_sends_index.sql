-- =============================================================================
-- 20260620800000_drop_duplicate_email_sends_index.sql
-- Limpieza detectada en auditoría: dos índices IDÉNTICOS sobre
-- email_sends(company_id, created_at desc):
--   · idx_sends_company_created        (20260508100000_mailing.sql:256)
--   · idx_email_sends_company_created  (20260527100000_smtp_dual_setup.sql:107)
-- Mantenemos el original (idx_sends_company_created) y eliminamos el duplicado.
-- =============================================================================

drop index if exists public.idx_email_sends_company_created;
