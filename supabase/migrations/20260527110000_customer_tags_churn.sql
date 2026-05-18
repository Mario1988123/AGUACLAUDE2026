-- =============================================================================
-- Etiquetas libres + score de churn para clientes.
-- =============================================================================

-- ===== customer_tags =====
-- Tabla de etiquetas con catálogo por empresa. Cada empresa define las
-- suyas (VIP, conflictivo, recomendador, etc.). No obligatorias.
create table if not exists public.customer_tag_catalog (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  label      text not null,
  color      text not null default 'slate'
    check (color in ('slate','red','amber','emerald','blue','violet','pink')),
  created_at timestamptz not null default now(),
  unique (company_id, label)
);
create index if not exists idx_ctag_catalog_company on public.customer_tag_catalog(company_id);

-- Asignación many-to-many entre customer y tag.
create table if not exists public.customer_tags (
  customer_id uuid not null references public.customers(id) on delete cascade,
  tag_id      uuid not null references public.customer_tag_catalog(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (customer_id, tag_id)
);
create index if not exists idx_ctag_customer on public.customer_tags(customer_id);
create index if not exists idx_ctag_tag on public.customer_tags(tag_id);

-- ===== customer.churn_score =====
-- 0-100. Calculado por cron diario o on-demand. NULL = no calculado aún.
alter table public.customers
  add column if not exists churn_score smallint
    check (churn_score is null or (churn_score >= 0 and churn_score <= 100)),
  add column if not exists churn_score_at timestamptz;

comment on column public.customers.churn_score is
  'Riesgo de churn 0-100. Calculado por cron diario combinando: '
  'inactividad, devoluciones de pago, mantenimientos atrasados, NPS bajo.';

-- ===== RLS =====
alter table public.customer_tag_catalog enable row level security;
alter table public.customer_tags enable row level security;

drop policy if exists ctc_super on public.customer_tag_catalog;
create policy ctc_super on public.customer_tag_catalog
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists ctc_select on public.customer_tag_catalog;
create policy ctc_select on public.customer_tag_catalog
  for select to authenticated using (company_id = app.current_company_id());

drop policy if exists ctc_manage on public.customer_tag_catalog;
create policy ctc_manage on public.customer_tag_catalog
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in ('company_admin','commercial_director')
         and ur.revoked_at is null
    )
  )
  with check (company_id = app.current_company_id());

drop policy if exists ct_super on public.customer_tags;
create policy ct_super on public.customer_tags
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists ct_select on public.customer_tags;
create policy ct_select on public.customer_tags
  for select to authenticated using (
    exists (
      select 1 from public.customers c
       where c.id = customer_tags.customer_id
         and c.company_id = app.current_company_id()
    )
  );

drop policy if exists ct_manage on public.customer_tags;
create policy ct_manage on public.customer_tags
  for all to authenticated
  using (
    exists (
      select 1 from public.customers c
       where c.id = customer_tags.customer_id
         and c.company_id = app.current_company_id()
    )
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in ('company_admin','commercial_director','telemarketing_director')
         and ur.revoked_at is null
    )
  );

notify pgrst, 'reload schema';
