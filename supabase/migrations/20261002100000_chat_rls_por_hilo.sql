-- =============================================================================
-- 20261002100000_chat_rls_por_hilo.sql
-- Auditoría 2026-10-01, hallazgo C1: chat legible sin login y difundido por
-- Realtime a todas las empresas.
--
-- Estado en producción antes de esta migración:
--   chat_messages        chat_messages_company  SELECT {public}  USING true
--   chat_thread_members  chat_members_self      SELECT {public}  USING true
--   chat_threads         chat_threads_company   SELECT {public}
--                        USING company_id = COALESCE(jwt.company_id, company_id)
--                        (siempre cierto si el JWT no trae company_id = anónimo)
--   anon y authenticated con TODOS los privilegios en las tres tablas.
--
-- Lo que hace:
--   1. Quita a `anon` cualquier privilegio sobre las tablas del chat.
--   2. Deja a `authenticated` solo SELECT (la app escribe siempre con el
--      service_role desde las server actions; el navegador solo lee por
--      Realtime).
--   3. Crea app.chat_puede_leer_hilo(thread_id): mismo hilo de mi empresa
--      (app.current_company_id(), sin COALESCE), no borrado, y además
--      broadcast (avisos generales: toda la empresa) o soy miembro.
--      Es SECURITY DEFINER para que las políticas de chat_messages y
--      chat_thread_members puedan consultar chat_threads/chat_thread_members
--      sin recursión de RLS.
--   4. Sustituye las políticas de SELECT de las tres tablas por esa regla,
--      solo para `authenticated`.
--
-- Realtime (postgres_changes) evalúa la RLS de SELECT con el JWT de cada
-- suscriptor, así que esto también corta la difusión entre empresas. El
-- cliente (chat-shell.tsx) filtra además por thread_id=in.(…).
--
-- Idempotente: se puede ejecutar varias veces.
-- =============================================================================

-- 1) y 2) Privilegios ----------------------------------------------------------
revoke all on table public.chat_messages, public.chat_threads, public.chat_thread_members
  from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.chat_messages, public.chat_threads, public.chat_thread_members
  from authenticated;
grant select on table public.chat_messages, public.chat_threads, public.chat_thread_members
  to authenticated;

-- 3) Función de acceso ---------------------------------------------------------
create or replace function app.chat_puede_leer_hilo(p_thread_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_threads t
    where t.id = p_thread_id
      and t.deleted_at is null
      and t.company_id = app.current_company_id()
      and (
        t.kind::text = 'broadcast'
        or exists (
          select 1
          from public.chat_thread_members m
          where m.thread_id = t.id
            and m.user_id = auth.uid()
        )
      )
  );
$$;

comment on function app.chat_puede_leer_hilo(uuid) is
  'C1 auditoría 2026-10-01: true si el usuario del JWT puede leer el hilo (misma empresa, no borrado, broadcast o miembro). Usada por la RLS del chat y, por tanto, por Realtime.';

revoke all on function app.chat_puede_leer_hilo(uuid) from public, anon;
grant execute on function app.chat_puede_leer_hilo(uuid) to authenticated;

-- RLS activada (ya lo está en producción; se repite por si acaso).
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_thread_members enable row level security;

-- 4) Políticas -----------------------------------------------------------------
-- Se borran tanto las que hay en producción como las de la migración
-- 20260531180000 (que nunca llegó a aplicarse en el remoto).
drop policy if exists chat_threads_company on public.chat_threads;
drop policy if exists chat_threads_tenant_select on public.chat_threads;
drop policy if exists chat_threads_tenant_modify on public.chat_threads;
drop policy if exists chat_threads_lectura_hilo on public.chat_threads;

create policy chat_threads_lectura_hilo on public.chat_threads
  for select to authenticated
  using ( app.chat_puede_leer_hilo(id) );

drop policy if exists chat_messages_company on public.chat_messages;
drop policy if exists chat_messages_tenant_select on public.chat_messages;
drop policy if exists chat_messages_tenant_modify on public.chat_messages;
drop policy if exists chat_messages_lectura_hilo on public.chat_messages;

create policy chat_messages_lectura_hilo on public.chat_messages
  for select to authenticated
  using ( app.chat_puede_leer_hilo(thread_id) );

drop policy if exists chat_members_self on public.chat_thread_members;
drop policy if exists chat_thread_members_tenant_select on public.chat_thread_members;
drop policy if exists chat_thread_members_tenant_modify on public.chat_thread_members;
drop policy if exists chat_thread_members_lectura_hilo on public.chat_thread_members;

create policy chat_thread_members_lectura_hilo on public.chat_thread_members
  for select to authenticated
  using ( app.chat_puede_leer_hilo(thread_id) );

-- Comprobación tras aplicar (debe devolver 0 filas con roles {public} o anon):
--   select tablename, policyname, roles, qual from pg_policies
--   where tablename like 'chat%';
