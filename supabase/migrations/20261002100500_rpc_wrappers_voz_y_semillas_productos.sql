-- =============================================================================
-- 20261002100500_rpc_wrappers_voz_y_semillas_productos.sql
--
-- Auditoría 2026-10-01, hallazgo I2.
--
-- PostgREST solo expone `public,graphql_public` (db_schema verificado en el
-- remoto). Estas seis funciones existen SOLO en `app`, así que todas las
-- llamadas `supabase.rpc(...)` del código fallaban con PGRST202:
--
--   app.voice_purge_transcripts        → cron voice-retention (21/21 ok=false)
--   app.voice_release_stale_tasks      → cron voice-calls
--   app.voice_claim_tasks              → cron voice-calls (claimed = [] siempre)
--   app.voice_company_for_inbound      → /api/voice-agent/inbound
--   app.import_global_water_categories → botón "Importar categorías estándar"
--   app.import_standard_service_lines  → botón "Importar líneas de servicio"
--
-- Mismo patrón que 20260828100000_seed_wrappers_service_role.sql: wrapper en
-- `public`, SECURITY DEFINER, search_path fijo y grants mínimos.
--
-- Grants:
--   · voice_*  → SOLO service_role. Los llama el cliente admin desde crons y
--     webhooks; un usuario autenticado no debe poder purgar transcripciones ni
--     reclamar tareas de llamada.
--   · import_* → authenticated. Las funciones `app.import_*` llevan su propia
--     guardia basada en el JWT: exigen que p_company_id sea la empresa del
--     usuario (app.current_company_id()) y que sea company_admin, salvo
--     superadmin. Con service_role auth.uid() es NULL y la guardia las
--     rechazaría SIEMPRE; por eso la app las llama con el cliente del USUARIO,
--     no con el admin. anon queda fuera.
--
-- voice_claim_tasks: el wrapper NO delega en app.voice_claim_tasks. Lleva el
-- mismo cuerpo más un filtro OPCIONAL por empresa (p_company_id). La función
-- original reclama por propósito en TODAS las empresas, y el cron la llama
-- dentro de un bucle por empresa: la empresa A se quedaba las tareas de B, las
-- descartaba (defensa en profundidad del cron) y las dejaba en 'calling' hasta
-- que voice_release_stale_tasks las soltaba, gastando un intento. Con
-- p_company_id el cron solo reclama lo suyo. Con null se comporta igual que la
-- original, así que es compatible con la llamada actual del cron.
-- p_purpose se recibe como text y se castea al enum, para no depender de que
-- PostgREST resuelva un tipo del schema `app`.
--
-- Idempotente: create or replace + revoke/grant. Solo añade funciones.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Agente de voz — SOLO service_role
-- -----------------------------------------------------------------------------
create or replace function public.voice_purge_transcripts(p_limit integer default 500)
returns integer
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select app.voice_purge_transcripts(p_limit);
$$;
comment on function public.voice_purge_transcripts(integer) is
  'Wrapper PostgREST de app.voice_purge_transcripts (purga RGPD). Solo service_role. Auditoría 2026-10-01 I2.';
revoke all on function public.voice_purge_transcripts(integer) from public, anon, authenticated;
grant execute on function public.voice_purge_transcripts(integer) to service_role;

create or replace function public.voice_release_stale_tasks(p_minutes integer default 15)
returns integer
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select app.voice_release_stale_tasks(p_minutes);
$$;
comment on function public.voice_release_stale_tasks(integer) is
  'Wrapper PostgREST de app.voice_release_stale_tasks. Solo service_role. Auditoría 2026-10-01 I2.';
revoke all on function public.voice_release_stale_tasks(integer) from public, anon, authenticated;
grant execute on function public.voice_release_stale_tasks(integer) to service_role;

create or replace function public.voice_company_for_inbound(p_to_number text)
returns uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select app.voice_company_for_inbound(p_to_number);
$$;
comment on function public.voice_company_for_inbound(text) is
  'Wrapper PostgREST de app.voice_company_for_inbound. Solo service_role. Auditoría 2026-10-01 I2.';
revoke all on function public.voice_company_for_inbound(text) from public, anon, authenticated;
grant execute on function public.voice_company_for_inbound(text) to service_role;

create or replace function public.voice_claim_tasks(
  p_purpose    text,
  p_limit      integer default 10,
  p_token      uuid    default gen_random_uuid(),
  p_company_id uuid    default null
)
returns setof public.voice_call_tasks
language sql
security definer
set search_path = public, app, pg_temp
as $$
  update public.voice_call_tasks t
     set status     = 'calling',
         locked_at  = now(),
         lock_token = p_token,
         attempts   = t.attempts + 1
   where t.id in (
     select id from public.voice_call_tasks
      where status = 'pending'
        and purpose = p_purpose::app.voice_call_purpose
        and next_attempt_at <= now()
        and (p_company_id is null or company_id = p_company_id)
      order by next_attempt_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning t.*;
$$;
comment on function public.voice_claim_tasks(text, integer, uuid, uuid) is
  'Reclama tareas de llamada (cuerpo de app.voice_claim_tasks + filtro opcional por empresa). Solo service_role. Auditoría 2026-10-01 I2.';
revoke all on function public.voice_claim_tasks(text, integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.voice_claim_tasks(text, integer, uuid, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 2) Semillas de productos — authenticated (la guardia vive en app.import_*)
-- -----------------------------------------------------------------------------
create or replace function public.import_global_water_categories(p_company_id uuid)
returns table(inserted_count integer, skipped_count integer)
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select * from app.import_global_water_categories(p_company_id);
$$;
comment on function public.import_global_water_categories(uuid) is
  'Wrapper PostgREST de app.import_global_water_categories. La guardia (company_admin de la empresa del JWT o superadmin) está en la función app. Auditoría 2026-10-01 I2.';
revoke all on function public.import_global_water_categories(uuid) from public, anon;
grant execute on function public.import_global_water_categories(uuid) to authenticated, service_role;

create or replace function public.import_standard_service_lines(p_company_id uuid)
returns table(inserted_count integer, skipped_count integer)
language sql
security definer
set search_path = public, app, pg_temp
as $$
  select * from app.import_standard_service_lines(p_company_id);
$$;
comment on function public.import_standard_service_lines(uuid) is
  'Wrapper PostgREST de app.import_standard_service_lines. La guardia (company_admin de la empresa del JWT o superadmin) está en la función app. Auditoría 2026-10-01 I2.';
revoke all on function public.import_standard_service_lines(uuid) from public, anon;
grant execute on function public.import_standard_service_lines(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3) Higiene: las app.import_* tenían execute para authenticated. No son
--    alcanzables por PostgREST y el wrapper es security definer (corre como
--    su dueño), así que ya no lo necesitan. Las app.voice_* ya estaban
--    restringidas al dueño.
-- -----------------------------------------------------------------------------
revoke all on function app.import_global_water_categories(uuid) from public, anon, authenticated;
revoke all on function app.import_standard_service_lines(uuid) from public, anon, authenticated;

-- Que PostgREST vea las funciones nuevas sin esperar al siguiente reinicio.
notify pgrst, 'reload schema';
