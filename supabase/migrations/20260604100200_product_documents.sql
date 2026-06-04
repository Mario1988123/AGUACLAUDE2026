-- =============================================================================
-- 20260604100200_product_documents.sql
-- Fase 1 del Plan Productos v2.
-- Documentos adjuntos a un producto (manuales PDF de usuario / instalador,
-- ficha técnica del fabricante, certificados, garantías, lista de recambios,
-- etc.). El bucket de Supabase Storage se crea on-demand desde la app vía
-- ensureBucket() (helper en src/shared/lib/supabase/storage-buckets.ts).
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'product_document_kind') then
    create type app.product_document_kind as enum (
      'manual_user',
      'manual_installer',
      'manufacturer_datasheet',
      'certificate',
      'warranty_card',
      'compliance_doc',
      'spare_parts_list',
      'other'
    );
  end if;
end $$;

create table if not exists public.product_documents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  kind            app.product_document_kind not null default 'other',
  title           text not null,
  storage_path    text not null,                              -- empieza siempre por company_id/ por la RLS de storage
  file_size_bytes integer,
  mime_type       text,
  is_public       boolean not null default false,             -- expuesto en la URL pública del producto
  display_order   integer not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null
);

create index if not exists idx_pdoc_product on public.product_documents(product_id);
create index if not exists idx_pdoc_company on public.product_documents(company_id);

alter table public.product_documents enable row level security;
alter table public.product_documents force row level security;

drop policy if exists pdoc_super on public.product_documents;
create policy pdoc_super on public.product_documents
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Nivel 1, 2 y 3 leen los documentos (los necesitan para descargar y mostrar
-- al cliente). Coherente con la regla "nivel 2-3 solo lee productos".
drop policy if exists pdoc_select_tenant on public.product_documents;
create policy pdoc_select_tenant on public.product_documents
  for select to authenticated using (company_id = app.current_company_id());

-- Solo admin (nivel 1) sube / borra / edita documentos.
drop policy if exists pdoc_admin_manage on public.product_documents;
create policy pdoc_admin_manage on public.product_documents
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

comment on table public.product_documents is
  'Documentos adjuntos a un producto. Bucket "product-documents" creado on-demand via ensureBucket().';

notify pgrst, 'reload schema';
