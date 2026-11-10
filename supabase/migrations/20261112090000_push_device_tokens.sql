-- =============================================================================
-- 20261112090000_push_device_tokens.sql
--
-- Tokens de push NATIVO de la app (Capacitor): el de APNs en iOS y el de FCM en
-- Android. Es la pareja de public.push_subscriptions, que guarda las
-- suscripciones de push WEB (navegador / PWA).
--
-- Quién escribe: SOLO el servidor con service_role
-- (registrarTokenDispositivoAction / darDeBajaTokenDispositivoAction y el
-- borrado de tokens caducados de push-send.ts). El usuario autenticado solo
-- puede LEER y BORRAR sus propias filas: así no puede apuntarse un token con la
-- empresa de otro ni reasignarse el dispositivo de un compañero.
--
-- Un token es de UN dispositivo: si otra persona inicia sesión en el mismo
-- móvil, la fila se reasigna a ella (índice único por token + upsert).
--
-- Idempotente: se puede lanzar dos veces sin romper nada.
-- =============================================================================

create table if not exists public.push_device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- Nulo solo para el superadmin, que no pertenece a ninguna empresa.
  company_id   uuid references public.companies(id) on delete cascade,
  platform     text not null,
  token        text not null,
  app_version  text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_device_tokens_platform_chk
    check (platform in ('ios', 'android')),
  constraint push_device_tokens_token_chk
    check (char_length(token) between 32 and 4096),
  constraint push_device_tokens_app_version_chk
    check (app_version is null or char_length(app_version) <= 32)
);

comment on table public.push_device_tokens is
  'Tokens de push nativo de la app (APNs en iOS, FCM en Android). Solo escribe el servidor.';

-- Un token, una fila (y el destino del upsert).
create unique index if not exists uniq_push_device_tokens_token
  on public.push_device_tokens (token);

-- Envío: "todos los dispositivos de este usuario". Cubre también la FK.
create index if not exists idx_push_device_tokens_user
  on public.push_device_tokens (user_id);

-- FK a companies: sin este índice, borrar una empresa recorre la tabla entera.
create index if not exists idx_push_device_tokens_company
  on public.push_device_tokens (company_id);

alter table public.push_device_tokens enable row level security;

-- RLS por usuario. (select auth.uid()) entre paréntesis para que Postgres lo
-- evalúe una vez por consulta y no una vez por fila.
drop policy if exists push_device_tokens_leer_propios on public.push_device_tokens;
create policy push_device_tokens_leer_propios on public.push_device_tokens
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists push_device_tokens_borrar_propios on public.push_device_tokens;
create policy push_device_tokens_borrar_propios on public.push_device_tokens
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Sin políticas de INSERT ni UPDATE: con RLS activa, authenticated no puede
-- escribir. Además se le quitan los permisos de tabla que no necesita, y a
-- anon todos.
revoke all on public.push_device_tokens from anon;
revoke insert, update, truncate, references, trigger on public.push_device_tokens from authenticated;
grant select, delete on public.push_device_tokens to authenticated;
grant all on public.push_device_tokens to service_role;

notify pgrst, 'reload schema';
