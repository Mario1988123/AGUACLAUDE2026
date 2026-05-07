-- =============================================================================
-- GoCardless — domiciliación SEPA + Instant Bank Pay
-- =============================================================================
-- Permite a la empresa configurar GoCardless (acces token + webhook secret),
-- crear mandatos contra clientes (redirect flow donde el cliente firma online)
-- y crear pagos contra mandatos activos. El estado se sincroniza por webhook.
--
-- Esquema mínimo: settings por empresa, mandatos, pagos. No duplicamos
-- contract_payments / wallet_entries — al cobrar GoCardless creamos un
-- wallet_entry method='direct_debit' status='pending' que la confirmación
-- del webhook validará automáticamente.
-- =============================================================================

-- 1. Settings por empresa
create table if not exists public.gocardless_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  environment text not null default 'sandbox' check (environment in ('sandbox', 'live')),
  access_token text not null,
  webhook_secret text,
  organisation_id text,                -- ID GoCardless tras primer test connect
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gocardless_settings enable row level security;

-- 2. Mandatos (un cliente puede tener varios pero típicamente 1 activo)
create table if not exists public.gocardless_mandates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  gocardless_mandate_id text not null unique,        -- "MD000..."
  gocardless_customer_id text,                       -- "CU000..."
  gocardless_bank_account_id text,                   -- "BA000..."
  scheme text not null default 'sepa_core',          -- sepa_core, bacs, ach...
  status text not null default 'pending_submission', -- pending_submission|submitted|active|cancelled|failed|expired
  reference text,                                    -- referencia mostrada al cliente
  account_holder_name text,
  iban_last4 text,
  bank_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index if not exists gocardless_mandates_company_idx on public.gocardless_mandates(company_id);
create index if not exists gocardless_mandates_customer_idx on public.gocardless_mandates(customer_id);
alter table public.gocardless_mandates enable row level security;

-- 3. Redirect flows (cliente firmando un mandato — temporal)
create table if not exists public.gocardless_redirect_flows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  gocardless_redirect_flow_id text not null unique,  -- "RE000..."
  redirect_url text not null,                        -- URL donde mandar al cliente
  session_token text not null,
  status text not null default 'created',            -- created|completed|expired
  mandate_id uuid references public.gocardless_mandates(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists gocardless_redirect_flows_company_idx on public.gocardless_redirect_flows(company_id);
alter table public.gocardless_redirect_flows enable row level security;

-- 4. Pagos creados contra un mandato
create table if not exists public.gocardless_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  mandate_id uuid not null references public.gocardless_mandates(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  contract_id uuid references public.contracts(id) on delete set null,
  invoice_id uuid references public.invoices(id) on delete set null,
  contract_payment_id uuid references public.contract_payments(id) on delete set null,
  wallet_entry_id uuid references public.wallet_entries(id) on delete set null,
  gocardless_payment_id text not null unique,        -- "PM000..."
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'EUR',
  description text,
  status text not null default 'pending_submission', -- pending_submission|submitted|confirmed|paid_out|failed|charged_back|cancelled
  charge_date date,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_out_at timestamptz
);
create index if not exists gocardless_payments_company_idx on public.gocardless_payments(company_id);
create index if not exists gocardless_payments_customer_idx on public.gocardless_payments(customer_id);
create index if not exists gocardless_payments_mandate_idx on public.gocardless_payments(mandate_id);
create index if not exists gocardless_payments_invoice_idx on public.gocardless_payments(invoice_id);
alter table public.gocardless_payments enable row level security;

-- 5. Webhook events (para idempotencia + auditoría)
create table if not exists public.gocardless_webhook_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  gocardless_event_id text not null unique,
  resource_type text not null,
  action text not null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists gocardless_webhook_events_company_idx on public.gocardless_webhook_events(company_id);

-- 6. RLS — las server actions usan admin client. Sólo super tiene acceso directo.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'gocardless_settings',
    'gocardless_mandates',
    'gocardless_redirect_flows',
    'gocardless_payments',
    'gocardless_webhook_events'
  ]) loop
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())',
      t || '_super', t
    );
  end loop;
end $$;

-- 7. Trigger updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_gocardless_settings_updated on public.gocardless_settings;
create trigger trg_gocardless_settings_updated before update on public.gocardless_settings
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_gocardless_mandates_updated on public.gocardless_mandates;
create trigger trg_gocardless_mandates_updated before update on public.gocardless_mandates
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_gocardless_payments_updated on public.gocardless_payments;
create trigger trg_gocardless_payments_updated before update on public.gocardless_payments
  for each row execute function public.touch_updated_at();
