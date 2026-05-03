-- =============================================================================
-- 20260503190000_chat_realtime.sql
-- Habilita Supabase Realtime (replicación INSERT/UPDATE) sobre las tablas de
-- chat para que el cliente reciba mensajes en vivo.
-- =============================================================================

-- Asegurar que la publicación supabase_realtime existe (la trae Supabase).
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Añadir tablas si no están ya en la publicación (idempotente)
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_threads'
  ) then
    alter publication supabase_realtime add table public.chat_threads;
  end if;
end $$;
