-- =============================================================================
-- 20260622100000_installation_customer_confirmation.sql
-- Confirmación CLIENTE-side de la INSTALACIÓN por email + deep link público,
-- en paridad con el flujo de mantenimiento (/m/[token]).
--  · Email con CTA "confirmar / elegir otra fecha / posponer"
--  · Deep link público `/i/[token]` (single-use, expira a 30 días)
--  · Reagendar/posponer marca la instalación para que el equipo revise
--    disponibilidad de técnico y ruta antes de reconfirmar.
--
-- Tabla installation_confirmation_tokens: un token por instalación. RLS
-- bloquea acceso anónimo; solo el admin client (service-role) lee/escribe.
-- NO se tocan enums (se usan columnas booleanas + eventos) para evitar el
-- problema de "enum recién añadido en la misma transacción".
-- =============================================================================

create table if not exists public.installation_confirmation_tokens (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.installations(id) on delete cascade,
  token           text not null unique,
  expires_at      timestamptz not null,
  used_at         timestamptz,
  used_action     text,
  used_ip         inet,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ict_token on public.installation_confirmation_tokens (token);
create index if not exists idx_ict_installation on public.installation_confirmation_tokens (installation_id);

comment on table public.installation_confirmation_tokens is
  'Tokens single-use para el deep link público /i/[token] que el cliente recibe por email. Permiten confirmar / reagendar / posponer su instalación sin login.';
comment on column public.installation_confirmation_tokens.used_action is
  'Acción registrada: confirmed | rescheduled | postponed.';

alter table public.installation_confirmation_tokens enable row level security;

drop policy if exists ict_block_all on public.installation_confirmation_tokens;
create policy ict_block_all
  on public.installation_confirmation_tokens
  for all
  using (false)
  with check (false);

-- Tracking + estado en installations
alter table public.installations
  add column if not exists customer_confirm_sent_at     timestamptz,
  add column if not exists customer_confirmed_at        timestamptz,
  add column if not exists customer_reschedule_pending  boolean not null default false;

comment on column public.installations.customer_confirm_sent_at is
  'Fecha en que se mandó el email de confirmación de cita al cliente. Idempotencia.';
comment on column public.installations.customer_confirmed_at is
  'Fecha en que el cliente confirmó la cita desde el deep link público.';
comment on column public.installations.customer_reschedule_pending is
  'true si el cliente pidió otra fecha o posponer y el equipo aún no ha revisado disponibilidad/ruta.';

notify pgrst, 'reload schema';
