-- =============================================================================
-- 20260525170000_legal_notices.sql
-- Tabla global (cross-tenant) de avisos legales detectados por el cron
-- mensual del BOE. Admin revisa cada uno y marca como reviewed o
-- dismissed; el contenido se mantiene como bitácora histórica.
--
-- Cross-tenant porque el BOE es para todos. Cada empresa lo ve en
-- /fichajes/admin/leyes y decide si actúa.
-- =============================================================================

create table if not exists public.legal_notices (
  id              uuid primary key default gen_random_uuid(),
  /** Identificador BOE (p.ej. BOE-A-2026-12345) para dedupe. */
  boe_id          text unique,
  /** Fecha del BOE (no de detección). */
  boe_date        date,
  title           text not null,
  url             text,
  /** Keywords que dispararon la detección, separadas por coma. */
  keywords_matched text,
  /** Cuándo lo detectó nuestro cron. */
  fetched_at      timestamptz not null default now(),
  /** Si algún admin lo revisó (no se borra, queda como bitácora). */
  reviewed_at     timestamptz,
  reviewed_by     uuid references auth.users(id) on delete set null,
  /** Si admin lo descartó por no ser relevante. */
  dismissed_at    timestamptz,
  dismissed_by    uuid references auth.users(id) on delete set null,
  dismissed_reason text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_legal_notices_status
  on public.legal_notices(reviewed_at, dismissed_at, fetched_at desc);
create index if not exists idx_legal_notices_boe_date
  on public.legal_notices(boe_date desc);

comment on table public.legal_notices is
  'Avisos del BOE detectados mensualmente por cron. Admin revisa y marca como reviewed/dismissed. Cross-tenant.';

-- RLS: lectura para cualquier user autenticado (es global y público).
-- Marcado solo admin/director.
alter table public.legal_notices enable row level security;

drop policy if exists ln_super on public.legal_notices;
create policy ln_super on public.legal_notices
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists ln_select on public.legal_notices;
create policy ln_select on public.legal_notices
  for select to authenticated using (true);

drop policy if exists ln_admin_update on public.legal_notices;
create policy ln_admin_update on public.legal_notices
  for update to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in (
           'company_admin','commercial_director','technical_director','telemarketing_director'
         )
         and ur.revoked_at is null
    )
  );

notify pgrst, 'reload schema';
