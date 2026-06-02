-- ============================================================================
-- 20260602110000_backfill_user_status_active.sql
--
-- Backfill: usuarios que ya pasaron por /restablecer-password (tienen
-- activated_at not null) deberían tener status='active' pero quedaron
-- como 'invited' porque la lógica antigua no actualizaba el campo.
--
-- Esta migración corrige el histórico. El código nuevo (commit de hoy)
-- ya pone status='active' al cambiar la contraseña.
-- ============================================================================

update public.user_profiles
   set status = 'active'
 where activated_at is not null
   and status = 'invited';

-- Refresca el schema cache de PostgREST
notify pgrst, 'reload schema';
