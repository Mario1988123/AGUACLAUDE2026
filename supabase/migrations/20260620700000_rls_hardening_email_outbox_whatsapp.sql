-- =============================================================================
-- 20260620700000_rls_hardening_email_outbox_whatsapp.sql
-- Hardening de RLS detectado en auditoría:
--   1. email_outbox NO tenía RLS habilitado → cualquier acceso vía PostgREST
--      con clave anon/auth podía leer cuerpos de email + destinatarios de
--      TODOS los tenants. La app escribe siempre con service_role (bypass),
--      así que solo necesitamos restringir el acceso de usuarios autenticados.
--   2. whatsapp_sends tenía una policy de escritura `with check (true)` que
--      permitía a cualquier autenticado insertar filas para CUALQUIER empresa.
--
-- Patrón de company actual: idéntico al ya usado en whatsapp_sends
-- (subquery sobre user_profiles). El service_role omite RLS en ambos casos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. email_outbox — habilitar RLS + select scoped por empresa
-- -----------------------------------------------------------------------------
alter table public.email_outbox enable row level security;

drop policy if exists email_outbox_company_select on public.email_outbox;
create policy email_outbox_company_select on public.email_outbox
  for select to authenticated
  using (
    company_id = (
      select company_id from public.user_profiles where user_id = auth.uid()
    )
  );

-- No se define policy de escritura para `authenticated`: todas las inserciones
-- y actualizaciones de la cola pasan por service_role (createAdminClient), que
-- omite RLS. Así ningún usuario puede inyectar emails directamente.

-- -----------------------------------------------------------------------------
-- 2. whatsapp_sends — restringir la escritura al company del usuario
-- -----------------------------------------------------------------------------
drop policy if exists wa_admin_write on public.whatsapp_sends;
create policy wa_admin_write on public.whatsapp_sends
  for all to authenticated
  using (
    company_id = (
      select company_id from public.user_profiles where user_id = auth.uid()
    )
  )
  with check (
    company_id = (
      select company_id from public.user_profiles where user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
