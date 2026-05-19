-- ============================================================================
-- SEPA — mandatos de domiciliación + forma de pago de cuotas recurrentes
-- ----------------------------------------------------------------------------
-- Reglamento UE 260/2012 (SEPA). Dos esquemas:
--   · CORE — domiciliación clásica (particulares y empresas). Plazo de
--     devolución 8 semanas (sin motivo) + 13 meses si no autorizado.
--   · B2B  — solo empresas. Plazo devolución 2 días hábiles. Irrevocable
--     hasta el día anterior al cobro.
--
-- AGUACLAUDE: por defecto CORE. B2B opcional cuando el cliente es empresa.
--
-- Decisión usuario 2026-05-19:
--   · La 1ª cuota + fianza siguen el flujo actual (transferencia / tarjeta /
--     bizum / efectivo).
--   · Las CUOTAS RESTANTES (renting/alquiler) se cobran por SEPA por
--     defecto. El admin puede elegir transferencia en su lugar; en ese
--     caso el contrato muestra el IBAN de la empresa para que el cliente
--     ingrese cada mes.
-- ============================================================================

-- 1) Identificador SEPA único del acreedor (CID). Se rellena en
--    /configuracion/fiscal. Formato típico: ES##ZZZ######### (16 chars).
alter table public.company_settings
  add column if not exists sepa_creditor_id text;

comment on column public.company_settings.sepa_creditor_id is
  'Identificador SEPA del acreedor (CID). Formato ES##ZZZ######### (16 chars). Lo asigna la entidad bancaria al activar SEPA Core/B2B en la empresa.';

-- 2) Forma de pago de las cuotas RECURRENTES por contrato.
alter table public.contracts
  add column if not exists payment_method_recurring text
    check (payment_method_recurring is null
      or payment_method_recurring in ('direct_debit', 'transfer'));

comment on column public.contracts.payment_method_recurring is
  'Forma de cobro de las cuotas mensuales (renting/alquiler) tras la primera. direct_debit = remesa SEPA (default), transfer = el cliente hace transferencia manual cada mes.';

-- Default 'direct_debit' para nuevas filas con plan rental/renting (no
-- aplica a cash). Lo dejamos NULL en las existentes — la UI decide en
-- el wizard.

-- 3) Tabla sepa_mandates — un mandato por contrato con domiciliación.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'sepa_scheme') then
    create type app.sepa_scheme as enum ('core', 'b2b');
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_type where typname = 'sepa_mandate_status') then
    create type app.sepa_mandate_status as enum (
      'draft',
      'active',
      'cancelled',
      'expired'
    );
  end if;
end $$;

create table if not exists public.sepa_mandates (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  contract_id         uuid not null references public.contracts(id) on delete cascade,
  customer_id         uuid references public.customers(id) on delete set null,
  /**
   * Unique Mandate Reference. Generado al crear el mandato. Lo identifica
   * frente al banco. Max 35 chars (SEPA).
   */
  umr                 text not null,
  scheme              app.sepa_scheme not null default 'core',
  status              app.sepa_mandate_status not null default 'draft',
  /** Datos snapshot del DEUDOR al firmar el mandato. */
  debtor_name         text not null,
  debtor_tax_id       text,
  debtor_iban         text not null,
  debtor_bic          text,
  debtor_address      text,
  /** Datos snapshot del ACREEDOR (AGUACLAUDE-cliente) al firmar. */
  creditor_id         text not null,
  creditor_name       text not null,
  creditor_address    text,
  /** Tipo de pago: recurrente (renting/alquiler) o único. Default recurrente. */
  is_recurring        boolean not null default true,
  /** Firma del deudor (imagen PNG en storage) + lugar + fecha. */
  signed_at           timestamptz,
  signed_place        text,
  signature_image_path text,
  signature_ip        inet,
  /** PDF generado del mandato. */
  pdf_document_id     uuid references public.documents(id) on delete set null,
  /** Última vez que se usó el mandato para cobrar (cron mensual). */
  last_used_at        timestamptz,
  /** Cancelación: motivo y quién. */
  cancelled_at        timestamptz,
  cancelled_by        uuid references auth.users(id) on delete set null,
  cancellation_reason text,
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  unique (contract_id)
);

create index if not exists idx_sm_company on public.sepa_mandates(company_id, status);
create index if not exists idx_sm_customer on public.sepa_mandates(customer_id);
create index if not exists idx_sm_umr on public.sepa_mandates(umr);

comment on table public.sepa_mandates is
  'Mandato SEPA por contrato (uno único). Necesario para cobrar cuotas por domiciliación bancaria. CORE (default) o B2B. Firmado por cliente con imagen y trazabilidad IP.';
comment on column public.sepa_mandates.umr is
  'Unique Mandate Reference: identificador único del mandato frente al banco. Max 35 chars.';

-- 4) RLS multi-tenant
alter table public.sepa_mandates enable row level security;
drop policy if exists sm_super on public.sepa_mandates;
create policy sm_super on public.sepa_mandates for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists sm_tenant on public.sepa_mandates;
create policy sm_tenant on public.sepa_mandates for all to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());

notify pgrst, 'reload schema';
