-- =============================================================================
-- 20260503310000_invoicing.sql
-- Completa el módulo de facturación. Las tablas base existen desde
-- 20260501121900_parked_modules.sql; aquí endurecemos:
--   - extender invoice_status para incluir 'proforma' (si no existe)
--   - tabla invoice_payments (relación factura ↔ wallet_entry)
--   - función app.next_invoice_number(series_id)
--   - función app.seed_default_invoice_series(company_id)
--   - desaparcar el módulo en modules_catalog
-- =============================================================================

-- 1) Extender enum invoice_status con valores que pueden faltar (idempotente)
do $$ begin
  begin
    alter type app.invoice_status add value if not exists 'proforma';
  exception when others then null;
  end;
end $$;

-- 2) Tabla pivote factura ↔ wallet_entry (una factura puede tener varios cobros parciales)
create table if not exists public.invoice_payments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  wallet_entry_id uuid references public.wallet_entries(id) on delete set null,
  amount_cents    integer not null check (amount_cents > 0),
  paid_at         timestamptz not null default now(),
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_invoice_payments_invoice
  on public.invoice_payments(invoice_id, paid_at desc);
create index if not exists idx_invoice_payments_wallet
  on public.invoice_payments(wallet_entry_id);

-- 3) Función para reservar el siguiente número de la serie (atómico)
create or replace function app.next_invoice_number(p_series_id uuid)
returns table (number integer, fiscal_year integer)
language plpgsql
as $$
declare
  s record;
  cur_year int := extract(year from current_date)::int;
begin
  select id, current_year, next_number, resets_yearly
    into s
    from public.invoice_series
   where id = p_series_id
   for update;
  if not found then
    raise exception 'invoice_series % not found', p_series_id;
  end if;

  if s.resets_yearly and s.current_year is distinct from cur_year then
    update public.invoice_series
       set current_year = cur_year,
           next_number = 2
     where id = s.id;
    number := 1;
    fiscal_year := cur_year;
  else
    update public.invoice_series
       set current_year = cur_year,
           next_number = s.next_number + 1
     where id = s.id;
    number := s.next_number;
    fiscal_year := cur_year;
  end if;
  return next;
end;
$$;

-- 4) Crear series por defecto al activar el módulo en una empresa
create or replace function app.seed_default_invoice_series(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if not exists (
    select 1 from public.invoice_series
     where company_id = p_company_id and kind = 'invoice'
  ) then
    insert into public.invoice_series (company_id, kind, series_code, description, current_year, next_number, resets_yearly, is_active)
    values (p_company_id, 'invoice', 'A', 'Facturas', extract(year from current_date)::int, 1, true, true);
  end if;
  if not exists (
    select 1 from public.invoice_series
     where company_id = p_company_id and kind = 'credit_note'
  ) then
    insert into public.invoice_series (company_id, kind, series_code, description, current_year, next_number, resets_yearly, is_active)
    values (p_company_id, 'credit_note', 'R', 'Rectificativas', extract(year from current_date)::int, 1, true, true);
  end if;
  if not exists (
    select 1 from public.invoice_series
     where company_id = p_company_id and kind = 'proforma'
  ) then
    insert into public.invoice_series (company_id, kind, series_code, description, current_year, next_number, resets_yearly, is_active)
    values (p_company_id, 'proforma', 'P', 'Proforma', extract(year from current_date)::int, 1, true, true);
  end if;
end;
$$;
grant execute on function app.seed_default_invoice_series(uuid) to authenticated;

-- 5) Desaparcar el módulo invoicing
update public.modules_catalog
   set is_parked = false
 where key = 'invoicing';

-- 6) RLS en invoice_payments igual que el resto de invoicing
alter table public.invoice_payments enable row level security;
alter table public.invoice_payments force row level security;

drop policy if exists invoice_payments_super on public.invoice_payments;
create policy invoice_payments_super on public.invoice_payments
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists invoice_payments_select_tenant on public.invoice_payments;
create policy invoice_payments_select_tenant on public.invoice_payments
  for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists invoice_payments_admin on public.invoice_payments;
create policy invoice_payments_admin on public.invoice_payments
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));
