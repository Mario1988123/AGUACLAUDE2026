-- ============================================================================
-- 20260620500000_push_subscriptions.sql
-- Tabla de subscriptions push para notificaciones nativas. El backend
-- guarda endpoint + p256dh + auth de cada navegador suscrito.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  company_id   uuid references public.companies(id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create unique index if not exists uniq_push_subscriptions_endpoint
  on public.push_subscriptions(endpoint);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for all
  using (user_id = ((current_setting('request.jwt.claims', true)::jsonb ->> 'sub'))::uuid)
  with check (user_id = ((current_setting('request.jwt.claims', true)::jsonb ->> 'sub'))::uuid);

notify pgrst, 'reload schema';
