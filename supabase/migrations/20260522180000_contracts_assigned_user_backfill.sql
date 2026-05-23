-- =============================================================================
-- 20260522180000_contracts_assigned_user_backfill.sql
-- Bug detectado 2026-05-22: contracts.assigned_user_id quedaba NULL en
-- contratos creados directamente por el comercial (solo se rellenaba al
-- reasignar). awardSalesBundleOnInstall lee esa columna y devolvía
-- "sin_comercial_asignado" → el comercial nunca cobraba los puntos por
-- la venta tras instalarse, solo el instalador (que es el propio Mario
-- en muchos casos).
--
-- Fix en 3 capas:
--   1) Backfill: contracts existentes con assigned_user_id NULL pasan a
--      created_by (el que firmó como vendedor).
--   2) (En código) los nuevos inserts ponen assigned_user_id explícito.
--   3) (En código) awardSalesBundleOnInstall acepta fallback a created_by
--      por defensa adicional contra regresiones futuras.
--
-- Esta migración SOLO toca datos: el backfill es seguro y no destructivo;
-- si el comercial ya estaba asignado, no se sobrescribe.
-- =============================================================================

update public.contracts
   set assigned_user_id = created_by,
       assigned_at      = coalesce(assigned_at, created_at)
 where assigned_user_id is null
   and created_by is not null;

notify pgrst, 'reload schema';
