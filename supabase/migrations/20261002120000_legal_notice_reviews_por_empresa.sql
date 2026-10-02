-- =============================================================================
-- 20261002120000_legal_notice_reviews_por_empresa.sql
-- Auditoría 2026-10-01, hallazgo I18 (avisos del BOE globales).
--
-- legal_notices es un catálogo GLOBAL (lo rellena el cron boe-check) y no
-- tiene company_id, pero el "revisado" / "descartado" se guardaba en la propia
-- fila: un director que descartaba un aviso lo quitaba para TODAS las
-- empresas.
--
-- Esta tabla guarda el estado de cada aviso POR EMPRESA. Las columnas
-- reviewed_* / dismissed_* de legal_notices se dejan de usar desde el código
-- (no se borran por si algo antiguo las lee; hoy hay 0 avisos).
--
-- Escritura: solo desde server actions con el service_role (admin client).
-- Lectura con RLS: solo filas de mi empresa.
--
-- Idempotente.
-- =============================================================================

create table if not exists public.legal_notice_reviews (
  company_id        uuid not null references public.companies(id) on delete cascade,
  notice_id         uuid not null references public.legal_notices(id) on delete cascade,
  reviewed_at       timestamptz,
  reviewed_by       uuid,
  dismissed_at      timestamptz,
  dismissed_by      uuid,
  dismissed_reason  text,
  created_at        timestamptz not null default now(),
  primary key (company_id, notice_id)
);

comment on table public.legal_notice_reviews is
  'I18 auditoría 2026-10-01: estado (revisado/descartado) de cada aviso del BOE por empresa.';

create index if not exists legal_notice_reviews_notice_idx
  on public.legal_notice_reviews(notice_id);

alter table public.legal_notice_reviews enable row level security;

revoke all on table public.legal_notice_reviews from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.legal_notice_reviews from authenticated;
grant select on table public.legal_notice_reviews to authenticated;

drop policy if exists legal_notice_reviews_select on public.legal_notice_reviews;
create policy legal_notice_reviews_select on public.legal_notice_reviews
  for select to authenticated
  using ( company_id = app.current_company_id() );
