-- =============================================================================
-- 20260604100600_product_certifications.sql
-- Fase 1 del Plan Productos v2.
-- N:N entre `products` y `certifications_catalog`. Cada certificación de un
-- producto puede llevar nº de certificado, fechas y URL a un documento
-- escaneado.
-- =============================================================================

create table if not exists public.product_certifications (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  product_id            uuid not null references public.products(id) on delete cascade,
  certification_key     text not null references public.certifications_catalog(key) on delete restrict,
  certificate_number    text,                                       -- número emitido por el organismo
  issued_at             date,
  valid_until           date,
  issuer_name           text,                                       -- ej. "TÜV Süd", "NSF International"
  document_url          text,                                       -- PDF escaneado del certificado
  notes                 text,
  display_order         integer not null default 0,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) on delete set null,
  unique (product_id, certification_key)
);

create index if not exists idx_pcert_product on public.product_certifications(product_id);
create index if not exists idx_pcert_company on public.product_certifications(company_id);
create index if not exists idx_pcert_expiring on public.product_certifications(valid_until)
  where valid_until is not null;

alter table public.product_certifications enable row level security;
alter table public.product_certifications force row level security;

drop policy if exists pcert_super on public.product_certifications;
create policy pcert_super on public.product_certifications
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Nivel 1, 2 y 3 leen las certificaciones (van en la ficha técnica y el
-- catálogo público; cualquier rol que vea el producto las ve).
drop policy if exists pcert_select_tenant on public.product_certifications;
create policy pcert_select_tenant on public.product_certifications
  for select to authenticated using (company_id = app.current_company_id());

-- Solo admin gestiona las certificaciones.
drop policy if exists pcert_admin_manage on public.product_certifications;
create policy pcert_admin_manage on public.product_certifications
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

comment on table public.product_certifications is
  'Certificaciones asignadas a cada producto. Catálogo en certifications_catalog. Gestión solo admin.';

notify pgrst, 'reload schema';
