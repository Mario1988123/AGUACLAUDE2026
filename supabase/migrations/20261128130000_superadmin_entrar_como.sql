-- =============================================================================
-- Superadmin: «Entrar como» otro usuario (pedido por Mario el 25-11-2026, igual
-- que en Gesdep: fase de pruebas, acceso rápido a cualquier empresa).
--
-- Cada entrada deja una fila. Es lo que decide si la sesión actual es una
-- entrada «como» (y por tanto si se puede «Volver» con la sesión guardada del
-- superadmin): una cookie sola no basta, porque en un ordenador compartido
-- podría quedarse una vieja.
--
-- Sin políticas: solo la toca el servidor con el cliente de servicio.
-- =============================================================================

create table if not exists public.superadmin_entradas_como (
  id                 uuid primary key default gen_random_uuid(),
  superadmin_user_id uuid not null references auth.users(id) on delete cascade,
  destino_user_id    uuid not null references auth.users(id) on delete cascade,
  destino_company_id uuid references public.companies(id) on delete set null,
  destino_email      text,
  destino_nombre     text,
  ip                 text,
  user_agent         text,
  creada_at          timestamptz not null default now(),
  cerrada_at         timestamptz
);

create index if not exists superadmin_entradas_como_abiertas_idx
  on public.superadmin_entradas_como(destino_user_id) where cerrada_at is null;

alter table public.superadmin_entradas_como enable row level security;
alter table public.superadmin_entradas_como force row level security;
revoke all on table public.superadmin_entradas_como from anon, authenticated;

comment on table public.superadmin_entradas_como is
  'Entradas del superadmin en la cuenta de otro usuario («Entrar como»). Una fila abierta = sesión suplantada en curso.';

notify pgrst, 'reload schema';
