-- =============================================================================
-- Histórico de cambios de precio en productos.
-- Permite auditar quién y cuándo modificó cualquier precio (cash, renting,
-- alquiler) y devolverse a un precio previo si hace falta.
-- =============================================================================

create table if not exists public.product_price_history (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  changed_at      timestamptz not null default now(),
  changed_by      uuid references auth.users(id) on delete set null,
  /** Tipo de cambio: cash_price | individual_price | company_price | min_authorized | cost */
  change_kind     text not null check (change_kind in (
    'cash_price',
    'individual_price',
    'company_price',
    'min_authorized',
    'cost'
  )),
  /** Plan_type si aplica (cash / renting / rental), o null para cash global. */
  plan_type       text check (plan_type in ('cash','renting','rental') or plan_type is null),
  /** Duración del plan (meses), para renting con varias duraciones. */
  duration_months smallint,
  previous_cents  integer,
  new_cents       integer not null,
  reason          text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_pph_product on public.product_price_history(product_id, changed_at desc);
create index if not exists idx_pph_company on public.product_price_history(company_id);

alter table public.product_price_history enable row level security;

drop policy if exists pph_super on public.product_price_history;
create policy pph_super on public.product_price_history
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists pph_select on public.product_price_history;
create policy pph_select on public.product_price_history
  for select to authenticated using (company_id = app.current_company_id());

drop policy if exists pph_insert on public.product_price_history;
create policy pph_insert on public.product_price_history
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in ('company_admin','commercial_director')
         and ur.revoked_at is null
    )
  );

notify pgrst, 'reload schema';
