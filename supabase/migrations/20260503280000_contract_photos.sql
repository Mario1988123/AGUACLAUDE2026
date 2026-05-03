-- =============================================================================
-- 20260503280000_contract_photos.sql
-- Fotos asociadas a un contrato (DNI escaneado, IBAN, firma manuscrita, etc.)
-- Las imágenes viven en Supabase Storage bucket "contract-photos" (privado).
-- Esta tabla guarda la metadata + path.
-- =============================================================================

create table if not exists public.contract_photos (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  /** "id_card" | "iban" | "signature" | "other" */
  kind            text not null default 'other',
  storage_path    text not null,
  mime_type       text,
  size_bytes      integer,
  uploaded_at     timestamptz not null default now(),
  uploaded_by     uuid references auth.users(id),
  notes           text
);

create index if not exists idx_contract_photos_contract
  on public.contract_photos(contract_id, uploaded_at desc);
