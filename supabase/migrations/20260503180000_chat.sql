-- =============================================================================
-- 20260503180000_chat.sql
-- Chat interno con tres tipos de hilo:
--   broadcast → admin escribe, todos los usuarios de la empresa lo ven
--   team      → un líder (nivel 2) crea un hilo con su equipo
--   direct    → conversación 1↔1 entre dos usuarios
-- =============================================================================

-- ENUM tipo de hilo
do $$ begin
  if not exists (select 1 from pg_type where typname = 'chat_thread_kind') then
    create type chat_thread_kind as enum ('broadcast', 'team', 'direct');
  end if;
end $$;

-- Hilos
create table if not exists public.chat_threads (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  kind            chat_thread_kind not null,
  name            text,
  created_by      uuid not null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz,
  deleted_at      timestamptz
);
create index if not exists chat_threads_company_idx on public.chat_threads(company_id);
create index if not exists chat_threads_last_msg_idx on public.chat_threads(last_message_at desc);

-- Miembros de cada hilo (para broadcast no es necesario insertar a todos: la
-- visibilidad se resuelve por "kind=broadcast + same company"; sólo guarda
-- last_read_at para contar no leídos por usuario que sí ha entrado al hilo).
create table if not exists public.chat_thread_members (
  thread_id     uuid not null references public.chat_threads(id) on delete cascade,
  user_id       uuid not null,
  role          text not null default 'member', -- 'owner' | 'member'
  joined_at     timestamptz not null default now(),
  last_read_at  timestamptz,
  primary key (thread_id, user_id)
);
create index if not exists chat_thread_members_user_idx on public.chat_thread_members(user_id);

-- Mensajes
create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.chat_threads(id) on delete cascade,
  sender_id   uuid not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  deleted_at  timestamptz
);
create index if not exists chat_messages_thread_idx
  on public.chat_messages(thread_id, created_at desc);

-- Bump de last_message_at automáticamente al insertar mensaje
create or replace function public.bump_chat_thread_last_msg() returns trigger as $$
begin
  update public.chat_threads
     set last_message_at = new.created_at
   where id = new.thread_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_bump_chat_thread_last_msg on public.chat_messages;
create trigger trg_bump_chat_thread_last_msg
  after insert on public.chat_messages
  for each row execute function public.bump_chat_thread_last_msg();

-- RLS: las acciones de Supabase en este proyecto se hacen con admin client
-- desde server actions (bypass RLS). Habilitamos RLS por si en el futuro
-- alguien usa el cliente público.
alter table public.chat_threads enable row level security;
alter table public.chat_thread_members enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists chat_threads_company on public.chat_threads;
create policy chat_threads_company on public.chat_threads
  for select using (
    company_id = coalesce((current_setting('request.jwt.claims', true)::json ->> 'company_id')::uuid, company_id)
  );

drop policy if exists chat_messages_company on public.chat_messages;
create policy chat_messages_company on public.chat_messages
  for select using (true);

drop policy if exists chat_members_self on public.chat_thread_members;
create policy chat_members_self on public.chat_thread_members
  for select using (true);

comment on table public.chat_threads is
  'Hilos de chat interno por empresa. kind controla la semántica de visibilidad y permisos.';
comment on table public.chat_thread_members is
  'Miembros de un hilo. Para broadcast los miembros se materializan al primer acceso para llevar last_read_at.';
comment on table public.chat_messages is
  'Mensajes de chat. body en texto plano; el cliente escapa al renderizar.';
