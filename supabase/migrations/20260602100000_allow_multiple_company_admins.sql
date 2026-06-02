-- ============================================================================
-- 20260602100000_allow_multiple_company_admins.sql
--
-- Revierte la "decisión 1.12" (una empresa = un admin) por petición de
-- negocio (2026-06-02): permite N company_admin por empresa.
--
-- Motivo: empresas con un admin "jefe" y una persona de oficina que también
-- gestiona el CRM al 100 %. El segundo admin tiene los mismos permisos que
-- el primero (modelo "varias llaves maestras").
--
-- Reglas que SE MANTIENEN en código:
--   · Nadie puede eliminarse a sí mismo.
--   · Siempre tiene que quedar al menos un company_admin activo en la
--     empresa (ya validado contando admins, sigue funcionando con N).
--   · La unicidad (user_id, company_id, role_key) se mantiene — no se puede
--     asignar dos veces el mismo rol al mismo usuario.
-- ============================================================================

drop index if exists public.uniq_company_admin_per_company;

comment on table public.user_roles is
  'Asignación M:N user <-> role dentro de empresa. revoked_at marca histórico. Decisión 1.12 (1 admin/empresa) revertida 2026-06-02: ahora N admins.';

-- Refresca el schema cache de PostgREST
notify pgrst, 'reload schema';
