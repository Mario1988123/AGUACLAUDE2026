-- =============================================================================
-- 20260623400000_external_invoicing_provider.sql
--
-- Soporte para delegar la facturación (firma XAdES + envío AEAT) a un SaaS
-- externo en lugar de implementarlo en casa. Cada empresa elige su proveedor.
--
-- Decisión 2026-05-30: alternativa al XAdES in-house (project_xades_state.md).
-- En lugar de mantener la cripto AEAT nosotros, la empresa puede enchufar su
-- cuenta de Holded / Factura.com / Verifacta / Quipu / Odoo (lo que ya use)
-- y nuestras facturas se empujan por API a ese sistema, que las firma y
-- envía a AEAT por su cuenta.
--
-- Mutex con el modo verifactu interno: si tiene proveedor externo, NO
-- intentamos firmar+enviar nosotros (gate VERIFACTU_XADES_ENABLED sigue
-- relevante para empresas que NO usan proveedor externo y prefieren in-house).
-- =============================================================================

alter table public.company_settings
  add column if not exists external_invoicing_provider     text
    check (
      external_invoicing_provider is null or
      external_invoicing_provider in (
        'none',
        'verifacti',
        'invopop',
        'holded',
        'quipu',
        'odoo'
      )
    )
    default 'none',
  add column if not exists external_invoicing_environment  text
    check (
      external_invoicing_environment is null or
      external_invoicing_environment in ('sandbox', 'production')
    )
    default 'sandbox',
  add column if not exists external_invoicing_api_key_encrypted    bytea,
  add column if not exists external_invoicing_extra_encrypted      bytea,
  add column if not exists external_invoicing_last_test_at         timestamptz,
  add column if not exists external_invoicing_last_test_ok         boolean,
  add column if not exists external_invoicing_last_test_error      text;

comment on column public.company_settings.external_invoicing_provider is
  'Proveedor SaaS externo de facturación al que se empujan las facturas. NULL/none = facturación interna (modo simple o verifactu in-house).';
comment on column public.company_settings.external_invoicing_api_key_encrypted is
  'API key del proveedor externo cifrada AES-256-GCM (mismo cifrado que el cert FNMT).';
comment on column public.company_settings.external_invoicing_extra_encrypted is
  'JSON cifrado con parámetros extra del proveedor (URL/DB de Odoo, etc.).';

-- =============================================================================
-- Registro de envíos a proveedor externo (audit + reintentos)
-- =============================================================================
create table if not exists public.external_invoicing_submissions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  invoice_id          uuid references public.invoices(id) on delete set null,
  provider            text not null,
  status              text not null default 'pending'
    check (status in ('pending','sending','sent','failed')),
  attempt_number      integer not null default 0,
  sent_at             timestamptz,
  external_id         text,                -- ID asignado por el proveedor
  external_url        text,                -- Link al recurso en el proveedor
  request_payload     jsonb,
  response_payload    jsonb,
  error_code          text,
  error_message       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_ext_invoicing_subs_pending
  on public.external_invoicing_submissions(company_id, created_at)
  where status in ('pending','sending');
create index if not exists idx_ext_invoicing_subs_invoice
  on public.external_invoicing_submissions(invoice_id)
  where invoice_id is not null;

alter table public.external_invoicing_submissions enable row level security;

create policy ext_inv_subs_tenant_select on public.external_invoicing_submissions
  for select using (company_id = app.current_company_id());
create policy ext_inv_subs_service_write on public.external_invoicing_submissions
  for all using (false) with check (false);  -- solo service_role
-- (las inserciones se hacen desde server actions con admin client; RLS bloquea
--  inserts/updates desde anon o usuarios — defensa en profundidad).

comment on table public.external_invoicing_submissions is
  'Registro de envíos de facturas a proveedores externos (Holded, Verifacta, etc.). Audit + reintentos + ID del proveedor.';

notify pgrst, 'reload schema';
