-- =============================================================================
-- 20260503250000_consents.sql
-- Consentimientos RGPD/LSSI: log inmutable de aceptaciones del cliente.
-- =============================================================================

create table if not exists public.customer_consents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  customer_id     uuid not null references public.customers(id) on delete cascade,
  /** Tipo de consentimiento: 'commercial' | 'data_processing' | 'profiling' | … */
  kind            text not null,
  granted         boolean not null,
  /** Origen: 'contract_sign' | 'customer_creation' | 'manual' */
  source          text not null,
  source_ref_id   uuid,                  -- id del contrato/firma que originó
  evidence        jsonb not null default '{}'::jsonb,  -- ip, ua, hash documento
  granted_at      timestamptz not null default now(),
  recorded_by     uuid references auth.users(id)
);

create index if not exists idx_customer_consents_customer
  on public.customer_consents(company_id, customer_id, granted_at desc);

comment on table public.customer_consents is
  'Log inmutable de consentimientos del cliente. Append-only — nunca se actualizan ni borran filas, una revocación se registra como nueva fila con granted=false.';
