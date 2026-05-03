-- =============================================================================
-- 20260503290000_unpark_points.sql
-- El módulo "points" (programa de puntos) ya está IMPLEMENTADO al 100%:
-- - /configuracion/puntos (config + comisiones €)
-- - /puntos (ranking + mis puntos)
-- - awardPoints en lead, propuesta, instalación, mantenimiento, incidencia
-- - hitos / bonus mensuales
--
-- Por error histórico el seed dejó is_parked=true. Esta migración lo corrige
-- para que el superadmin pueda activarlo en empresas sin ver el badge "aparcado".
-- =============================================================================

update public.modules_catalog
   set is_parked = false
 where key = 'points';
