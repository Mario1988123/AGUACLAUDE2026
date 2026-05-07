-- =============================================================================
-- 20260508100000_mailing.sql
-- Módulo de mailing — emails transaccionales y campañas marketing.
--
-- Decisiones (usuario 2026-05-08):
--  · Cada usuario configura SU email empresa (maria@aguasl.com).
--  · Empresa verifica UN dominio (DKIM/SPF/DMARC) que cualquier *@dominio
--    pueda enviar autenticado.
--  · Doble opt-in obligatorio para marketing (RGPD-compliant).
--  · SIN tracking de apertura ni click (lo más limpio posible).
--  · Plantillas pre-creadas + admin puede crear más.
--  · Volumen estimado <1.000/mes → tier gratis Resend.
--
-- Dos sistemas coexisten:
--  · Transaccional: confirmación cita, factura, recordatorio (sin opt-out).
--  · Marketing: campañas, newsletters (con opt-in/out granular por lista).
--
-- Idempotente.
-- =============================================================================

-- ===========================================================================
-- 1. Dominios verificados por empresa
-- ===========================================================================
create table if not exists public.email_domains (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  domain              text not null,                                -- "aguasl.com"
  resend_domain_id    text,                                         -- ID interno Resend
  status              text not null default 'pending'
    check (status in ('pending', 'verified', 'failed', 'suspended')),
  spf_record          text,
  dkim_record         text,
  dmarc_record        text,
  verified_at         timestamptz,
  last_check_at       timestamptz,
  failure_reason      text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (company_id, domain)
);

create index if not exists idx_email_domains_company
  on public.email_domains(company_id);

comment on table public.email_domains is
  'Dominios verificados con DKIM/SPF/DMARC. Una empresa puede tener varios pero típicamente solo uno.';

-- ===========================================================================
-- 2. Settings de email por usuario (cada usuario su email empresa)
-- ===========================================================================
create table if not exists public.email_user_settings (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  from_email          text not null,                                -- maria@aguasl.com
  from_name           text,                                         -- "María García"
  signature_html      text,                                         -- HTML firma
  signature_text      text,                                         -- plain text fallback
  is_verified         boolean not null default false,               -- el dominio está verified
  reply_to_email      text,                                         -- opcional, distinto from
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_email_user_settings_company
  on public.email_user_settings(company_id);

-- ===========================================================================
-- 3. Plantillas de email (transaccionales + marketing)
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'email_template_kind') then
    create type app.email_template_kind as enum ('transactional', 'marketing');
  end if;
end $$;

create table if not exists public.email_templates (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid references public.companies(id) on delete cascade, -- NULL = sistema (todas)
  key                 text,                                         -- "appointment_reminder", "invoice_email"
  name                text not null,
  description         text,
  kind                app.email_template_kind not null,
  subject             text not null,                                -- soporta variables {{customer_name}}
  body_html           text not null,
  body_text           text,
  variables           text[] default '{}',                          -- nombres de variables que usa
  is_system           boolean not null default false,               -- pre-creadas, no editables
  is_active           boolean not null default true,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists uniq_email_templates_company_key
  on public.email_templates(company_id, key) where key is not null;
create index if not exists idx_email_templates_company
  on public.email_templates(company_id);

-- ===========================================================================
-- 4. Listas de marketing (cada lista tiene su opt-in granular)
-- ===========================================================================
create table if not exists public.email_lists (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  name                text not null,                                -- "Newsletter mensual"
  description         text,
  is_active           boolean not null default true,
  is_default          boolean not null default false,               -- al firmar contrato suscribe aquí
  total_subscribers   integer not null default 0,                   -- cache, refrescar con cron
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null
);

create index if not exists idx_email_lists_company
  on public.email_lists(company_id) where is_active;

-- ===========================================================================
-- 5. Suscripciones a listas (opt-in/opt-out granular)
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'email_subscription_status') then
    create type app.email_subscription_status as enum (
      'pending_confirmation',  -- esperando doble opt-in
      'active',                -- confirmado, recibe
      'unsubscribed',          -- se dio de baja
      'bounced',               -- email rebotó hard
      'complained'             -- marcó como spam
    );
  end if;
end $$;

create table if not exists public.email_subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  list_id             uuid not null references public.email_lists(id) on delete cascade,
  email               text not null,
  customer_id         uuid references public.customers(id) on delete set null,
  lead_id             uuid references public.leads(id) on delete set null,
  status              app.email_subscription_status not null default 'pending_confirmation',
  confirmation_token  text,                                         -- para link de confirmación
  confirmed_at        timestamptz,
  unsubscribed_at     timestamptz,
  unsubscribed_reason text,
  source              text,                                         -- "contract_signing","manual","api","import"
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (list_id, email)
);

create index if not exists idx_subs_company_list
  on public.email_subscriptions(company_id, list_id) where status = 'active';
create index if not exists idx_subs_email
  on public.email_subscriptions(email);
create index if not exists idx_subs_token
  on public.email_subscriptions(confirmation_token) where confirmation_token is not null;

-- ===========================================================================
-- 6. Consentimientos RGPD (registro inmutable)
-- ===========================================================================
create table if not exists public.email_consents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  email           text not null,
  customer_id     uuid references public.customers(id) on delete set null,
  lead_id         uuid references public.leads(id) on delete set null,
  scope           text not null check (scope in ('marketing','transactional','both')),
  action          text not null check (action in ('granted','revoked')),
  source          text not null,                                    -- "signup","contract_signing","double_opt_in","unsubscribe_link","import"
  ip_address      inet,
  user_agent      text,
  occurred_at     timestamptz not null default now()
);

create index if not exists idx_consents_email
  on public.email_consents(company_id, email, occurred_at desc);

-- ===========================================================================
-- 7. Tokens únicos para link de baja (RFC 8058)
-- ===========================================================================
create table if not exists public.email_unsubscribe_tokens (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique,
  company_id      uuid not null references public.companies(id) on delete cascade,
  email           text not null,
  list_id         uuid references public.email_lists(id) on delete cascade,  -- NULL = baja TOTAL
  expires_at      timestamptz,                                      -- NULL = no expira
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_unsub_tokens_token on public.email_unsubscribe_tokens(token);

-- ===========================================================================
-- 8. Envíos individuales (uno por destinatario)
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'email_send_status') then
    create type app.email_send_status as enum (
      'queued',
      'sending',
      'sent',          -- entregado al servidor del receptor
      'delivered',     -- aceptado por mailbox
      'bounced',       -- rebotó (hard o soft)
      'complained',    -- marcado como spam
      'failed'         -- error nuestro o del proveedor
    );
  end if;
end $$;

create table if not exists public.email_sends (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  user_id             uuid references auth.users(id) on delete set null,    -- quien envía (puede ser system)
  template_id         uuid references public.email_templates(id) on delete set null,
  campaign_id         uuid,                                         -- FK añadida abajo

  -- Destinatario
  to_email            text not null,
  to_name             text,
  customer_id         uuid references public.customers(id) on delete set null,
  lead_id             uuid references public.leads(id) on delete set null,

  -- Emisor
  from_email          text not null,
  from_name           text,
  reply_to_email      text,

  -- Contenido
  subject             text not null,
  body_html           text,
  body_text           text,

  -- Naturaleza
  kind                app.email_template_kind not null,             -- transactional o marketing

  -- Estado y proveedor
  status              app.email_send_status not null default 'queued',
  resend_id           text,                                         -- id devuelto por Resend
  error_code          text,
  error_message       text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  bounced_at          timestamptz,

  -- Adjuntos (PDFs etc.)
  attachments_meta    jsonb default '[]'::jsonb,                    -- { name, size, kind }

  -- Trazabilidad cruzada
  related_subject_type text,                                        -- "contract","invoice","installation","proposal"
  related_subject_id  uuid,

  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists idx_sends_company_created
  on public.email_sends(company_id, created_at desc);
create index if not exists idx_sends_customer
  on public.email_sends(customer_id, created_at desc) where customer_id is not null;
create index if not exists idx_sends_lead
  on public.email_sends(lead_id, created_at desc) where lead_id is not null;
create index if not exists idx_sends_pending
  on public.email_sends(company_id, created_at) where status in ('queued','sending');
create index if not exists idx_sends_resend_id
  on public.email_sends(resend_id) where resend_id is not null;

-- ===========================================================================
-- 9. Campañas marketing
-- ===========================================================================
do $$ begin
  if not exists (select 1 from pg_type where typname = 'email_campaign_status') then
    create type app.email_campaign_status as enum (
      'draft',
      'scheduled',
      'sending',
      'sent',
      'cancelled',
      'failed'
    );
  end if;
end $$;

create table if not exists public.email_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  name                text not null,
  template_id         uuid not null references public.email_templates(id) on delete restrict,
  list_id             uuid references public.email_lists(id) on delete restrict,

  -- Audiencia: además de list_id, segmentación dinámica
  audience_filter     jsonb default '{}'::jsonb,                    -- { customer_segment: "active_with_contract", excludes: ["..."] }

  status              app.email_campaign_status not null default 'draft',
  scheduled_at        timestamptz,
  sent_at             timestamptz,

  total_recipients    integer not null default 0,
  total_sent          integer not null default 0,
  total_failed        integer not null default 0,
  total_unsubscribed  integer not null default 0,

  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_campaigns_company_status
  on public.email_campaigns(company_id, status, created_at desc);

-- FK email_sends → email_campaigns (la creamos después porque la tabla ya existía)
do $$ begin
  alter table public.email_sends
    add constraint email_sends_campaign_fk
    foreign key (campaign_id) references public.email_campaigns(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ===========================================================================
-- 10. Automatizaciones (drip / triggers)
-- ===========================================================================
create table if not exists public.email_automations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  name            text not null,
  trigger_kind    text not null,                                    -- "contract_signed","installation_completed","lead_inactive","customer_birthday"
  trigger_config  jsonb default '{}'::jsonb,                        -- p.ej. {days_after: 7, min_potential: "B"}
  is_active       boolean not null default true,
  total_executed  integer not null default 0,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.email_automation_steps (
  id              uuid primary key default gen_random_uuid(),
  automation_id   uuid not null references public.email_automations(id) on delete cascade,
  step_order      integer not null,
  delay_days      integer not null default 0,                       -- 0 = inmediato
  delay_hours     integer not null default 0,
  template_id     uuid not null references public.email_templates(id) on delete restrict,
  unique (automation_id, step_order)
);

-- Tabla para trackear qué entidad ya recibió qué paso (idempotencia automática)
create table if not exists public.email_automation_runs (
  id              uuid primary key default gen_random_uuid(),
  automation_id   uuid not null references public.email_automations(id) on delete cascade,
  step_id         uuid not null references public.email_automation_steps(id) on delete cascade,
  subject_type    text not null,                                    -- "customer","lead","contract","installation"
  subject_id      uuid not null,
  email_send_id   uuid references public.email_sends(id) on delete set null,
  ran_at          timestamptz not null default now(),
  unique (step_id, subject_type, subject_id)
);

create index if not exists idx_automation_runs_automation
  on public.email_automation_runs(automation_id, ran_at desc);

-- ===========================================================================
-- 11. RLS — solo company_admin gestiona, lectura compartida con scope
-- ===========================================================================
alter table public.email_domains enable row level security;
alter table public.email_user_settings enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_lists enable row level security;
alter table public.email_subscriptions enable row level security;
alter table public.email_consents enable row level security;
alter table public.email_unsubscribe_tokens enable row level security;
alter table public.email_sends enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_automations enable row level security;
alter table public.email_automation_steps enable row level security;
alter table public.email_automation_runs enable row level security;

-- Policies super (las server actions usan admin client)
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'email_domains','email_user_settings','email_templates','email_lists',
    'email_subscriptions','email_consents','email_unsubscribe_tokens',
    'email_sends','email_campaigns','email_automations',
    'email_automation_steps','email_automation_runs'
  ]) loop
    execute format(
      'create policy if not exists %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())',
      t || '_super', t
    );
  end loop;
end $$;

-- ===========================================================================
-- 12. Trigger: contar suscriptores activos en la lista (cache)
-- ===========================================================================
create or replace function public.refresh_list_subscribers_count()
returns trigger language plpgsql as $$
declare
  v_list_id uuid;
begin
  v_list_id := coalesce(new.list_id, old.list_id);
  update public.email_lists
     set total_subscribers = (
       select count(*) from public.email_subscriptions
        where list_id = v_list_id and status = 'active'
     )
   where id = v_list_id;
  return null;
end $$;

drop trigger if exists trg_subs_count on public.email_subscriptions;
create trigger trg_subs_count
  after insert or update or delete on public.email_subscriptions
  for each row execute function public.refresh_list_subscribers_count();
