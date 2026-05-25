-- =============================================================================
-- 20260525110000_maintenance_customer_confirmation.sql
-- Flujo de confirmación CLIENTE-side por email + deep link público:
--  · Email 14 días antes con CTA "confirmar / elegir fecha / posponer"
--  · Email 24h antes con "reconfirmar / posponer"
--  · Si el cliente "pospone" → status='needs_callback' + notif admin
--
-- Tabla maintenance_confirmation_tokens almacena un token por job para
-- el deep link público `/m/[token]`. Tokens single-use, expiran a los
-- 30 días. RLS bloquea acceso anónimo; solo admin client lee/escribe.
-- =============================================================================

-- 1) Añadir 'needs_callback' al enum maintenance_status
do $$ begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'maintenance_status' and e.enumlabel = 'needs_callback'
  ) then
    alter type app.maintenance_status add value 'needs_callback' after 'preprogrammed';
  end if;
end $$;

-- 2) Tabla de tokens
create table if not exists public.maintenance_confirmation_tokens (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.maintenance_jobs(id) on delete cascade,
  token       text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_action text,
  used_ip     inet,
  created_at  timestamptz not null default now()
);

create index if not exists idx_mct_token on public.maintenance_confirmation_tokens (token);
create index if not exists idx_mct_job on public.maintenance_confirmation_tokens (job_id);

comment on table public.maintenance_confirmation_tokens is
  'Tokens single-use para el deep link público /m/[token] que el cliente recibe por email. Permiten confirmar / reagendar / posponer una visita sin login.';
comment on column public.maintenance_confirmation_tokens.used_action is
  'Acción registrada: confirmed | rescheduled | postponed | reconfirmed.';

alter table public.maintenance_confirmation_tokens enable row level security;

-- Bloqueamos TODO acceso por RLS. Solo el admin client (service-role,
-- bypass RLS) puede leer/escribir. La verificación de token la hace el
-- endpoint manualmente con admin client.
drop policy if exists mct_block_all on public.maintenance_confirmation_tokens;
create policy mct_block_all
  on public.maintenance_confirmation_tokens
  for all
  using (false)
  with check (false);

-- 3) Tracking de envíos en maintenance_jobs
alter table public.maintenance_jobs
  add column if not exists customer_reminder_sent_at   timestamptz,
  add column if not exists customer_day_before_sent_at timestamptz;

comment on column public.maintenance_jobs.customer_reminder_sent_at is
  'Fecha en que se mandó el email de "confirma tu próxima visita" (14d antes). Idempotencia para el cron.';
comment on column public.maintenance_jobs.customer_day_before_sent_at is
  'Fecha en que se mandó el email de víspera (24h antes). Idempotencia para el cron.';

-- 4) Índice de cola needs_callback
create index if not exists idx_mjobs_needs_callback
  on public.maintenance_jobs (company_id, scheduled_at)
  where status = 'needs_callback';

notify pgrst, 'reload schema';
