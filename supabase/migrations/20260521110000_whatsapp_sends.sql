-- =============================================================================
-- 20260521110000_whatsapp_sends.sql
-- Registro de envíos de WhatsApp (vía Twilio) para tener trazabilidad en el
-- dashboard de Mailing y poder agruparlos por comercial / cliente.
-- =============================================================================

create table if not exists public.whatsapp_sends (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  user_id             uuid references auth.users(id) on delete set null,    -- quien envía (null = system/cron)

  -- Destinatario
  to_phone            text not null,                                         -- E164 +34XXXXXXXXX
  customer_id         uuid references public.customers(id) on delete set null,
  lead_id             uuid references public.leads(id) on delete set null,

  -- Contenido
  body                text,                                                  -- texto literal o NULL si template_sid
  template_sid        text,                                                  -- Twilio Content SID si plantilla aprobada
  template_variables  jsonb,                                                 -- variables para la plantilla

  -- Estado y proveedor
  status              text not null default 'queued',                        -- queued | sending | sent | delivered | read | failed
  message_sid         text,                                                  -- SID Twilio
  error_code          text,
  error_message       text,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,

  -- Trazabilidad cruzada
  related_subject_type text,                                                 -- "contract","installation","incident",...
  related_subject_id  uuid,

  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists idx_wa_company_created
  on public.whatsapp_sends(company_id, created_at desc);
create index if not exists idx_wa_customer
  on public.whatsapp_sends(customer_id, created_at desc) where customer_id is not null;
create index if not exists idx_wa_user
  on public.whatsapp_sends(user_id, created_at desc) where user_id is not null;
create index if not exists idx_wa_message_sid
  on public.whatsapp_sends(message_sid) where message_sid is not null;

alter table public.whatsapp_sends enable row level security;

drop policy if exists wa_company_select on public.whatsapp_sends;
create policy wa_company_select on public.whatsapp_sends
  for select to authenticated
  using (company_id = (select company_id from public.user_profiles where user_id = auth.uid()));

drop policy if exists wa_admin_write on public.whatsapp_sends;
create policy wa_admin_write on public.whatsapp_sends
  for all to authenticated
  using (true) with check (true);

notify pgrst, 'reload schema';
