-- =============================================================================
-- 20260507200000_invoicing_verifactu.sql
-- Módulo de FACTURACIÓN compliant con Reglamento Verifactu
-- (Real Decreto 1007/2023 + Orden HAC/1177/2024 + Real Decreto 254/2025).
--
-- IMPORTANTE: las tablas `invoices`, `invoice_series`, `invoice_lines`
-- YA EXISTEN desde la migración 20260501121900_parked_modules.sql.
-- Esta migración EXTIENDE el esquema con ADD COLUMN IF NOT EXISTS
-- para no romper datos existentes. Las tablas Verifactu nuevas
-- (registros encadenados, eventos, envíos AEAT) sí se crean nuevas.
--
-- Idempotente: usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.
-- =============================================================================

-- ===========================================================================
-- 1. EXTENDER invoice_series con campos Verifactu nuevos
-- Conservamos nombres antiguos (series_code, resets_yearly, description)
-- para no romper el sistema de facturación previo.
-- ===========================================================================
alter table public.invoice_series
  add column if not exists invoice_type text default 'F1',
  add column if not exists prefix text,
  add column if not exists is_default boolean not null default false,
  add column if not exists updated_at timestamptz default now();

-- Garantizar enum invoice_type acepta valores Verifactu
do $$ begin
  alter table public.invoice_series
    add constraint invoice_series_invoice_type_chk
    check (invoice_type in ('F1','F2','F3','R1','R2','R3','R4','R5'));
exception when duplicate_object then null; when invalid_table_definition then null;
end $$;

create index if not exists idx_invoice_series_company_active
  on public.invoice_series(company_id) where is_active = true;

-- ===========================================================================
-- 2. EXTENDER invoices con campos Verifactu
-- ===========================================================================
alter table public.invoices
  add column if not exists deleted_at timestamptz,
  add column if not exists invoice_type text default 'F1',
  add column if not exists customer_snapshot jsonb default '{}'::jsonb,
  add column if not exists installation_id uuid references public.installations(id) on delete set null,
  add column if not exists proposal_id uuid references public.proposals(id) on delete set null,
  add column if not exists tax_total_cents bigint default 0,
  add column if not exists retention_cents bigint default 0,
  add column if not exists tax_regime text default '01',
  add column if not exists is_simplified boolean default false,
  add column if not exists is_rectificative boolean default false,
  add column if not exists rectifies_invoice_id uuid references public.invoices(id) on delete restrict,
  add column if not exists rectification_reason text,
  add column if not exists description text,
  add column if not exists legal_notes text,
  add column if not exists payment_method text,
  add column if not exists payment_iban text,
  add column if not exists paid_amount_cents bigint default 0,
  add column if not exists verifactu_hash text,
  add column if not exists verifactu_prev_hash text,
  add column if not exists verifactu_qr_url text,
  add column if not exists verifactu_csv text,
  add column if not exists verifactu_submitted_at timestamptz,
  add column if not exists reference_code text,
  add column if not exists issued_at timestamptz,
  add column if not exists operation_at date,
  add column if not exists due_at date,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists issued_by uuid references auth.users(id) on delete set null,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists cancelled_reason text;

-- Backfill columnas que mapean a otros nombres existentes
do $$ begin
  -- Si la tabla tiene total_cents y no tax_total_cents, ya están las viejas;
  -- nada que hacer.
  -- Si tiene tax_cents (vieja) y no tax_total_cents, copiamos
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='invoices' and column_name='tax_cents'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='invoices' and column_name='tax_total_cents'
  ) then
    update public.invoices set tax_total_cents = tax_cents
      where tax_total_cents = 0 and tax_cents is not null;
  end if;
end $$;

-- Índices con la columna deleted_at recién añadida
create index if not exists idx_invoices_company_status
  on public.invoices(company_id, status) where deleted_at is null;
create index if not exists idx_invoices_customer
  on public.invoices(customer_id) where deleted_at is null;
create index if not exists idx_invoices_contract
  on public.invoices(contract_id) where contract_id is not null;
create index if not exists idx_invoices_issued_at
  on public.invoices(company_id, issued_at desc) where status != 'draft';
create index if not exists idx_invoices_reference
  on public.invoices(reference_code);

-- ===========================================================================
-- 3. EXTENDER invoice_lines
-- ===========================================================================
alter table public.invoice_lines
  add column if not exists tax_rate numeric(5,2) default 21,
  add column if not exists tax_cents bigint default 0,
  add column if not exists retention_rate numeric(5,2) default 0,
  add column if not exists retention_cents bigint default 0,
  add column if not exists total_cents bigint default 0,
  add column if not exists is_exempt boolean default false,
  add column if not exists exempt_reason text,
  add column if not exists is_reverse_charge boolean default false;

-- ===========================================================================
-- 4. invoice_taxes (puede no existir)
-- ===========================================================================
create table if not exists public.invoice_taxes (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  tax_rate        numeric(5,2) not null,
  base_cents      bigint not null,
  tax_cents       bigint not null,
  is_exempt       boolean not null default false,
  exempt_reason   text,
  created_at      timestamptz not null default now(),
  unique (invoice_id, tax_rate, is_exempt)
);
create index if not exists idx_invoice_taxes_invoice on public.invoice_taxes(invoice_id);

-- ===========================================================================
-- 5. REGISTRO VERIFACTU ENCADENADO (NUEVO — hash chain inmutable)
-- ===========================================================================
create table if not exists public.invoice_verifactu_records (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  invoice_id                  uuid not null references public.invoices(id) on delete restrict,
  record_type                 text not null check (record_type in ('alta', 'anulacion')),
  issuer_nif                  text not null,
  issuer_name                 text not null,
  series_code                 text not null,
  invoice_number              bigint not null,
  invoice_type                text not null,
  issued_at                   timestamptz not null,
  operation_date              date not null,
  recipient_nif               text,
  recipient_name              text,
  recipient_country           text default 'ES',
  base_total_cents            bigint not null,
  tax_total_cents             bigint not null,
  total_cents                 bigint not null,
  prev_hash                   text not null,
  current_hash                text not null,
  hash_algorithm              text not null default 'SHA-256',
  qr_url                      text not null,
  qr_params                   jsonb not null default '{}'::jsonb,
  sent_to_aeat                boolean not null default false,
  sent_at                     timestamptz,
  aeat_response_status        text,
  aeat_csv                    text,
  aeat_response_payload       jsonb,
  aeat_error_code             text,
  aeat_error_message          text,
  created_at                  timestamptz not null default now()
);

create index if not exists idx_verifactu_company_date
  on public.invoice_verifactu_records(company_id, issued_at desc);
create index if not exists idx_verifactu_invoice
  on public.invoice_verifactu_records(invoice_id);
create index if not exists idx_verifactu_pending_aeat
  on public.invoice_verifactu_records(company_id, created_at)
  where sent_to_aeat = false;

-- Trigger inmutabilidad
create or replace function public.verifactu_records_block_changes()
returns trigger language plpgsql as $$
begin
  raise exception 'Los registros Verifactu son INMUTABLES (Reglamento Verifactu). No se permite UPDATE ni DELETE en invoice_verifactu_records.';
end $$;

drop trigger if exists verifactu_records_immutable on public.invoice_verifactu_records;
create trigger verifactu_records_immutable
  before update or delete on public.invoice_verifactu_records
  for each row execute function public.verifactu_records_block_changes();

-- ===========================================================================
-- 6. EVENTOS DEL SISTEMA INFORMÁTICO (audit log)
-- ===========================================================================
create table if not exists public.invoice_verifactu_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete set null,
  event_type      text not null,
  severity        text not null default 'info',
  payload         jsonb not null default '{}'::jsonb,
  user_id         uuid references auth.users(id) on delete set null,
  ip_address      inet,
  occurred_at     timestamptz not null default now()
);
create index if not exists idx_verifactu_events_company
  on public.invoice_verifactu_events(company_id, occurred_at desc);

-- ===========================================================================
-- 7. ENVÍOS A AEAT (cola con reintentos)
-- ===========================================================================
create table if not exists public.invoice_aeat_submissions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  record_id           uuid not null references public.invoice_verifactu_records(id) on delete cascade,
  attempt_number      integer not null default 1,
  status              text not null default 'pending',
  request_xml         text,
  response_xml        text,
  error_code          text,
  error_message       text,
  sent_at             timestamptz,
  responded_at        timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_aeat_submissions_pending
  on public.invoice_aeat_submissions(company_id, created_at)
  where status = 'pending';

-- ===========================================================================
-- 8. CERTIFICADO FNMT por empresa
-- ===========================================================================
alter table public.company_settings
  add column if not exists verifactu_cert_alias text,
  add column if not exists verifactu_cert_encrypted bytea,
  add column if not exists verifactu_cert_password_encrypted text,
  add column if not exists verifactu_cert_expires_at date,
  add column if not exists verifactu_mode text default 'no_envio',
  add column if not exists verifactu_environment text default 'production';

do $$ begin
  alter table public.company_settings
    add constraint company_settings_verifactu_mode_chk
    check (verifactu_mode in ('no_envio','verifactu','verifactu_test'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.company_settings
    add constraint company_settings_verifactu_env_chk
    check (verifactu_environment in ('production','test','sandbox'));
exception when duplicate_object then null;
end $$;

-- ===========================================================================
-- 9. RLS — Verifactu records
-- ===========================================================================
alter table public.invoice_verifactu_records enable row level security;
alter table public.invoice_verifactu_events enable row level security;
alter table public.invoice_aeat_submissions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='invoice_verifactu_records' and policyname='verifactu_records_super') then
    create policy verifactu_records_super on public.invoice_verifactu_records
      for all to authenticated
      using (app.is_superadmin()) with check (app.is_superadmin());
  end if;
  if not exists (select 1 from pg_policies where tablename='invoice_verifactu_events' and policyname='verifactu_events_super') then
    create policy verifactu_events_super on public.invoice_verifactu_events
      for all to authenticated
      using (app.is_superadmin()) with check (app.is_superadmin());
  end if;
  if not exists (select 1 from pg_policies where tablename='invoice_aeat_submissions' and policyname='aeat_submissions_super') then
    create policy aeat_submissions_super on public.invoice_aeat_submissions
      for all to authenticated
      using (app.is_superadmin()) with check (app.is_superadmin());
  end if;
end $$;

-- ===========================================================================
-- 10. FUNCIÓN ATÓMICA para asignar siguiente número de serie
-- ===========================================================================
create or replace function public.allocate_next_invoice_number(p_series_id uuid)
returns bigint
language plpgsql
security definer
as $$
declare
  v_year integer;
  v_next bigint;
  v_cur_year integer;
  v_resets boolean;
begin
  v_year := extract(year from now())::int;

  select current_year, resets_yearly
    into v_cur_year, v_resets
    from public.invoice_series
   where id = p_series_id
   for update;

  if not found then
    raise exception 'Serie no encontrada %', p_series_id;
  end if;

  if coalesce(v_resets, true) and coalesce(v_cur_year, v_year) != v_year then
    update public.invoice_series
       set next_number = 1,
           current_year = v_year,
           updated_at = now()
     where id = p_series_id;
  end if;

  update public.invoice_series
     set next_number = next_number + 1,
         updated_at = now()
   where id = p_series_id
   returning next_number - 1 into v_next;

  return v_next;
end $$;
