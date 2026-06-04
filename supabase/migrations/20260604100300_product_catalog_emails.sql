-- =============================================================================
-- 20260604100300_product_catalog_emails.sql
-- Fase 1 del Plan Productos v2.
-- Auditoría de catálogos / fichas técnicas enviados por email (vía Resend).
-- Permite ver a quién se mandó qué catálogo, qué productos llevaba y qué
-- precios se hicieron visibles.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'product_email_kind') then
    create type app.product_email_kind as enum (
      'catalog',                -- catálogo de varios productos / categoría
      'product_datasheet'       -- ficha técnica de un único producto
    );
  end if;
end $$;

create table if not exists public.product_catalog_emails (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  kind                app.product_email_kind not null,
  sent_by             uuid references auth.users(id) on delete set null,

  -- Destinatario
  recipient_email     text not null,
  recipient_name      text,
  customer_id         uuid references public.customers(id) on delete set null,
  lead_id             uuid references public.leads(id) on delete set null,

  -- Contenido enviado
  category_ids        uuid[],                                     -- categorías incluidas en el catálogo
  product_ids         uuid[] not null,                            -- productos incluidos
  pricing_visibility  jsonb,                                      -- por producto, qué precios se mostraron
  custom_title        text,                                       -- título del catálogo
  custom_message      text,                                       -- cuerpo del email (opcional override)

  -- URL pública asociada (si se generó)
  public_share_token  text,

  -- PDF (solo se rellena para fichas técnicas; los catálogos van por URL)
  pdf_storage_path    text,

  -- Resend tracking
  resend_email_id     text,
  sent_at             timestamptz not null default now(),
  opened_at           timestamptz,
  clicked_at          timestamptz,
  bounced_at          timestamptz,

  notes               text
);

create index if not exists idx_pce_company on public.product_catalog_emails(company_id, sent_at desc);
create index if not exists idx_pce_customer on public.product_catalog_emails(customer_id) where customer_id is not null;
create index if not exists idx_pce_lead on public.product_catalog_emails(lead_id) where lead_id is not null;
create index if not exists idx_pce_share on public.product_catalog_emails(public_share_token) where public_share_token is not null;

alter table public.product_catalog_emails enable row level security;
alter table public.product_catalog_emails force row level security;

drop policy if exists pce_super on public.product_catalog_emails;
create policy pce_super on public.product_catalog_emails
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Lectura: admin y directores. Sales rep / installer / telemarketer no ven
-- el log de envíos del catálogo (es información comercial agregada).
drop policy if exists pce_select_managers on public.product_catalog_emails;
create policy pce_select_managers on public.product_catalog_emails
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.has_role('company_admin')
      or app.has_role('commercial_director')
      or app.has_role('technical_director')
      or app.has_role('telemarketing_director')
    )
  );

-- Inserción: cualquier usuario autenticado en la empresa que envíe (queda
-- trazado por sent_by). Pero recordemos que la UI solo permite enviar a
-- admin/dirs y comerciales con acceso al lead/cliente — esta política
-- es la malla de seguridad final.
drop policy if exists pce_insert_tenant on public.product_catalog_emails;
create policy pce_insert_tenant on public.product_catalog_emails
  for insert to authenticated
  with check (company_id = app.current_company_id());

-- Actualización: solo admin para corregir destinatario / notas tras envío.
drop policy if exists pce_update_admin on public.product_catalog_emails;
create policy pce_update_admin on public.product_catalog_emails
  for update to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

comment on table public.product_catalog_emails is
  'Auditoría de catálogos y fichas técnicas enviados por email. Visible a admin y directores.';

notify pgrst, 'reload schema';
