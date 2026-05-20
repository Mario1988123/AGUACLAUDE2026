-- ============================================================================
-- 20260620100000_sepa_batches.sql
-- Idempotencia generación remesa SEPA pain.008 (decisión 2026-05-20):
-- guardamos cada batch generado con sus contract_payments lockeados.
-- Si el admin pulsa "generar" dos veces, el segundo intento detecta el
-- batch abierto y devuelve el mismo XML (no regenera con datos distintos
-- ni dobla el cobro en banco).
-- ============================================================================

create table if not exists public.sepa_batches (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  msg_id          text not null,
  status          text not null default 'open' check (status in ('open','sent','cancelled')),
  total_cents     integer not null,
  num_transactions integer not null,
  xml             text not null,
  generated_by    uuid references auth.users(id) on delete set null,
  generated_at    timestamptz not null default now(),
  sent_at         timestamptz,
  cancelled_at    timestamptz,
  cancelled_reason text
);

create unique index if not exists uniq_sepa_batch_msg_id
  on public.sepa_batches(company_id, msg_id);

create index if not exists idx_sepa_batches_company_status
  on public.sepa_batches(company_id, status);

alter table public.contract_payments
  add column if not exists sepa_batch_id uuid references public.sepa_batches(id) on delete set null;

create index if not exists idx_cp_sepa_batch
  on public.contract_payments(sepa_batch_id)
  where sepa_batch_id is not null;

comment on table public.sepa_batches is
  'Registro de remesas SEPA pain.008 generadas. Garantiza idempotencia: un mismo lote no se descarga 2 veces como XMLs distintos ni se cobra 2 veces en banco.';
comment on column public.contract_payments.sepa_batch_id is
  'FK al batch SEPA donde se incluyó este pago. Mientras esté informado y batch.status=open, el pago está "lockeado": no se puede meter en otro batch.';

alter table public.sepa_batches enable row level security;

drop policy if exists sepa_batches_company on public.sepa_batches;
create policy sepa_batches_company on public.sepa_batches
  for all
  using (
    company_id = ((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'company_id'))::uuid
    or coalesce(((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'is_superadmin')::boolean), false)
  )
  with check (
    company_id = ((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'company_id'))::uuid
    or coalesce(((current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'is_superadmin')::boolean), false)
  );

-- Refresca el schema cache de PostgREST para que las nuevas columnas
-- estén disponibles sin reinicio (decisión 2026-05-20)
notify pgrst, 'reload schema';
