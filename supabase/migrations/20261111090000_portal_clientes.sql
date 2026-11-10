-- =============================================================================
-- Portal de clientes (2026-11-11)
--
-- La oficina da acceso a un cliente final: usuario = su DNI/NIE/CIF y una
-- contraseña generada que se le envía. El cliente entra en /portal y ve SUS
-- equipos, mantenimientos, contratos, incidencias y facturas.
--
-- Diseño de seguridad:
--   · El cliente es un usuario de auth.users con email sintético
--     (cliente-<id>@clientes.hidromanager.es), NUNCA tiene fila en
--     user_profiles ni user_roles. El hook custom_access_token_hook no le pone
--     company_id → app.current_company_id() es NULL → RLS no le deja leer
--     nada de ninguna empresa por PostgREST.
--   · Todo lo que ve el portal se lee en el servidor con service_role,
--     filtrando por customer_id y company_id de ESTA tabla.
--   · Esta tabla no tiene políticas: solo la toca service_role.
-- =============================================================================

create table if not exists public.customer_portal_accounts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  customer_id       uuid not null references public.customers(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  -- DNI/NIE/CIF normalizado (mayúsculas, sin espacios ni guiones). Es el usuario.
  login_tax_id      text not null check (login_tax_id ~ '^[A-Z0-9]{8,10}$'),
  auth_email        text not null,
  status            text not null default 'active' check (status in ('active', 'disabled')),
  -- Bloqueo por intentos fallidos (el limitador en memoria no sirve entre
  -- instancias de Vercel; esto sí).
  failed_attempts   integer not null default 0 check (failed_attempts >= 0),
  locked_until      timestamptz,
  last_login_at     timestamptz,
  password_set_at   timestamptz not null default now(),
  password_sent_at  timestamptz,
  password_sent_via text check (password_sent_via in ('email', 'whatsapp', 'manual')),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint customer_portal_accounts_customer_uniq unique (customer_id),
  constraint customer_portal_accounts_user_uniq unique (user_id),
  constraint customer_portal_accounts_email_uniq unique (auth_email)
);

-- Un mismo DNI solo puede tener un acceso por empresa. Entre empresas sí puede
-- repetirse (el login prueba la contraseña contra cada una).
create unique index if not exists customer_portal_accounts_company_tax_uniq
  on public.customer_portal_accounts (company_id, login_tax_id);

create index if not exists customer_portal_accounts_tax_idx
  on public.customer_portal_accounts (login_tax_id);

alter table public.customer_portal_accounts enable row level security;
-- Sin políticas a propósito: solo service_role.
revoke all on table public.customer_portal_accounts from anon, authenticated;

drop trigger if exists customer_portal_accounts_updated_at on public.customer_portal_accounts;
create trigger customer_portal_accounts_updated_at
  before update on public.customer_portal_accounts
  for each row execute function app.set_updated_at();

comment on table public.customer_portal_accounts is
  'Accesos de clientes finales al portal (/portal). Usuario = DNI normalizado. Solo service_role.';

-- Suma un intento fallido de forma ATÓMICA (dos peticiones en paralelo no
-- pueden leer el mismo contador) y bloquea al llegar al máximo.
create or replace function public.portal_registrar_fallo(p_cuenta uuid, p_max integer, p_minutos integer)
returns timestamptz
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.customer_portal_accounts
     set failed_attempts = case when failed_attempts + 1 >= p_max then 0 else failed_attempts + 1 end,
         locked_until    = case when failed_attempts + 1 >= p_max
                                then now() + make_interval(mins => p_minutos)
                                else locked_until end
   where id = p_cuenta
  returning locked_until;
$$;

revoke all on function public.portal_registrar_fallo(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.portal_registrar_fallo(uuid, integer, integer) to service_role;
