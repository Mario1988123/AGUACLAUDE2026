-- =============================================================================
-- 20260527100000_smtp_dual_setup.sql
--
-- Sustituye el envío vía Resend por SMTP genérico.
-- Cambios:
--   1) companies: añade DOS configuraciones SMTP separadas
--        - smtp_company_*    => cuenta SMTP general de la empresa
--                                (envíos manuales del admin como persona,
--                                 fallback para usuarios sin SMTP propio)
--        - smtp_automated_*  => cuenta SMTP genérica para automáticos del
--                                sistema (recordatorios, contratos, citas...)
--   2) email_user_settings: añade columnas SMTP por usuario
--        - cada usuario nivel 2/3 puede tener su propio SMTP
--        - cascada en el backend: user → company_manual → company_automated
--   3) email_outbox: añade metadatos para el módulo MAIL (histórico)
--        - send_type ('manual' | 'automated' | 'campaign')
--        - trigger_event ('maintenance_reminder', 'contract_signed', ...)
--        - from_account_type ('user' | 'company_manual' | 'company_automated')
--        - sender_user_id (quién disparó el envío; NULL si sistema)
--        - related_type / related_id (lead/customer/contract/... para scoping)
--   4) Drop tabla email_domains (era específica de Resend)
--   5) RLS policies para email_outbox (módulo MAIL):
--        - company_admin ve todo el histórico de su empresa
--        - directores (nivel 2) ven el histórico de su scope
--        - nivel 3 ve solo lo suyo
--        - almacen / desconocidos no ven nada
--
-- IMPORTANTE: las contraseñas SMTP se guardan CIFRADAS (AES-256-GCM) desde la
-- app antes de insertarlas. La BD las trata como texto opaco.
--
-- Idempotente. Aplicar manualmente en Supabase SQL Editor o con `supabase db push`.
-- =============================================================================

-- ===========================================================================
-- 1. companies → SMTP empresa (general + automático)
-- ===========================================================================
alter table public.companies
  add column if not exists smtp_company_host             text,
  add column if not exists smtp_company_port             integer,
  add column if not exists smtp_company_user             text,
  add column if not exists smtp_company_password_enc     text,
  add column if not exists smtp_company_from_email       text,
  add column if not exists smtp_company_from_name        text,
  add column if not exists smtp_company_secure           boolean default true,
  add column if not exists smtp_company_provider         text,    -- 'gmail' | 'outlook' | 'ionos' | ...
  add column if not exists smtp_company_updated_at       timestamptz,

  add column if not exists smtp_automated_host           text,
  add column if not exists smtp_automated_port           integer,
  add column if not exists smtp_automated_user           text,
  add column if not exists smtp_automated_password_enc   text,
  add column if not exists smtp_automated_from_email     text,
  add column if not exists smtp_automated_from_name      text,
  add column if not exists smtp_automated_secure         boolean default true,
  add column if not exists smtp_automated_provider       text,
  add column if not exists smtp_automated_updated_at     timestamptz;

comment on column public.companies.smtp_company_password_enc is
  'Contraseña SMTP cifrada con AES-256-GCM (ENCRYPTION_KEY). Nunca en claro.';
comment on column public.companies.smtp_automated_password_enc is
  'Contraseña SMTP cifrada con AES-256-GCM (ENCRYPTION_KEY). Nunca en claro.';

-- ===========================================================================
-- 2. email_user_settings → SMTP por usuario
-- ===========================================================================
alter table public.email_user_settings
  add column if not exists smtp_host             text,
  add column if not exists smtp_port             integer,
  add column if not exists smtp_user             text,
  add column if not exists smtp_password_enc     text,
  add column if not exists smtp_secure           boolean default true,
  add column if not exists smtp_provider         text,
  add column if not exists smtp_updated_at       timestamptz;

comment on column public.email_user_settings.smtp_password_enc is
  'Contraseña SMTP cifrada con AES-256-GCM. NULL = el usuario usa el SMTP de la empresa.';

-- `is_verified` ya no aplica (era para verificación de dominio en Resend).
-- Lo dejamos pero ignorado por el backend nuevo. No lo droppeamos para no
-- romper código viejo todavía.

-- ===========================================================================
-- 3. email_sends → metadatos para el módulo MAIL (histórico)
--
-- email_sends ya tenía: user_id (sender), customer_id, lead_id,
-- related_subject_type/id, status, kind, etc. Lo que falta para el módulo
-- MAIL y el routing SMTP correcto:
--   - send_type: distinguir manual/automated/campaign
--   - trigger_event: qué evento del sistema lo disparó (string libre)
--   - from_account_type: qué cuenta SMTP envió (user / company_manual / company_automated)
-- ===========================================================================
alter table public.email_sends
  add column if not exists send_type           text default 'manual'
    check (send_type in ('manual','automated','campaign')),
  add column if not exists trigger_event       text,
  add column if not exists from_account_type   text
    check (from_account_type in ('user','company_manual','company_automated'));

create index if not exists idx_email_sends_user_created
  on public.email_sends(user_id, created_at desc);
create index if not exists idx_email_sends_send_type
  on public.email_sends(send_type);
create index if not exists idx_email_sends_trigger_event
  on public.email_sends(trigger_event);
create index if not exists idx_email_sends_related
  on public.email_sends(related_subject_type, related_subject_id);
create index if not exists idx_email_sends_company_created
  on public.email_sends(company_id, created_at desc);

-- Backfill: lo que ya hay lo marcamos como manual (era envío directo del admin).
update public.email_sends
set send_type = 'manual',
    from_account_type = 'company_manual'
where send_type is null;

-- ===========================================================================
-- 4. Drop email_domains (era específico de Resend)
-- ===========================================================================
drop table if exists public.email_domains cascade;

-- ===========================================================================
-- 5. RLS para módulo MAIL — scoping por rol/jerarquía sobre email_sends
--
-- email_sends ya tenía RLS habilitada en la migración mailing original.
-- La sustituimos por una política que respete:
--   - company_admin: ve todo el histórico de su empresa
--   - directores (nivel 2): ven todo (placeholder; jerarquía fina más tarde)
--   - sales_rep / installer / telemarketer (nivel 3): solo los suyos
--     o los relacionados con leads/customers asignados a ellos
-- ===========================================================================
alter table public.email_sends enable row level security;

drop policy if exists email_sends_superadmin_all on public.email_sends;
create policy email_sends_superadmin_all on public.email_sends
  for all to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

-- Escritura: el backend (admin client) bypassa RLS, pero también permitimos
-- a usuarios autenticados insertar en su propia empresa para que server
-- actions con sesión funcionen sin ir por el admin client.
drop policy if exists email_sends_tenant_insert on public.email_sends;
create policy email_sends_tenant_insert on public.email_sends
  for insert to authenticated
  with check (company_id = app.current_company_id());

drop policy if exists email_sends_tenant_select on public.email_sends;
create policy email_sends_tenant_select on public.email_sends
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.has_role('company_admin')
      or app.has_role('technical_director')
      or app.has_role('commercial_director')
      or app.has_role('telemarketing_director')
      or user_id = auth.uid()
      or exists (
        select 1 from public.leads
        where leads.id = email_sends.lead_id
          and leads.assigned_user_id = auth.uid()
      )
      or exists (
        select 1 from public.customers
        where customers.id = email_sends.customer_id
          and customers.assigned_user_id = auth.uid()
      )
    )
  );

-- Update solo admin (para cancelar/marcar errores); el resto delega en el backend admin.
drop policy if exists email_sends_admin_update on public.email_sends;
create policy email_sends_admin_update on public.email_sends
  for update to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

-- ===========================================================================
-- 6. RLS para campos SMTP de empresa (companies)
-- ===========================================================================
-- companies ya tiene RLS habilitada (companies_tenant_read_self) que da SELECT
-- a la propia empresa. El UPDATE de los campos SMTP debe restringirse a
-- company_admin de esa empresa. Lo gestionamos con policy nueva.

drop policy if exists companies_tenant_admin_update_smtp on public.companies;
create policy companies_tenant_admin_update_smtp on public.companies
  for update to authenticated
  using (id = app.current_company_id() and app.has_role('company_admin'))
  with check (id = app.current_company_id() and app.has_role('company_admin'));

-- ===========================================================================
-- 7. RLS para email_user_settings (cada usuario gestiona el suyo,
--    admin puede gestionar los de su empresa)
-- ===========================================================================
alter table public.email_user_settings enable row level security;
alter table public.email_user_settings force row level security;

drop policy if exists email_user_settings_superadmin_all on public.email_user_settings;
create policy email_user_settings_superadmin_all on public.email_user_settings
  for all to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

drop policy if exists email_user_settings_self_select on public.email_user_settings;
create policy email_user_settings_self_select on public.email_user_settings
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (user_id = auth.uid() or app.has_role('company_admin'))
  );

drop policy if exists email_user_settings_self_upsert on public.email_user_settings;
create policy email_user_settings_self_upsert on public.email_user_settings
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and (user_id = auth.uid() or app.has_role('company_admin'))
  );

drop policy if exists email_user_settings_self_update on public.email_user_settings;
create policy email_user_settings_self_update on public.email_user_settings
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and (user_id = auth.uid() or app.has_role('company_admin'))
  )
  with check (
    company_id = app.current_company_id()
    and (user_id = auth.uid() or app.has_role('company_admin'))
  );

-- ===========================================================================
-- 8. Añadir módulo `mail` al catálogo (para el sidebar)
-- ===========================================================================
insert into public.modules_catalog (key, label_es, description_es, icon, is_core, default_active, sort_order)
values ('mail', 'Mail', 'Historial de emails enviados a leads y clientes', 'Mail', false, true, 850)
on conflict (key) do update set
  label_es = excluded.label_es,
  description_es = excluded.description_es,
  icon = excluded.icon;

-- Activar 'mail' para todas las empresas existentes
insert into public.company_modules (company_id, module_key, is_active)
select c.id, 'mail', true
from public.companies c
on conflict (company_id, module_key) do update set is_active = true;
