-- =============================================================================
-- Audit log de superadmin. Registra cada acción crítica (impersonar, crear
-- empresa, modificar módulos globales, override RLS, etc.).
-- =============================================================================

create table if not exists public.superadmin_audit_log (
  id              uuid primary key default gen_random_uuid(),
  actor_user_id   uuid not null references auth.users(id) on delete restrict,
  action          text not null,
  /** Empresa afectada (si aplica). */
  affected_company_id uuid references public.companies(id) on delete set null,
  /** Sujeto del cambio (entidad concreta si aplica). */
  subject_type    text,
  subject_id      uuid,
  payload         jsonb not null default '{}'::jsonb,
  ip_address      text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_saudit_actor on public.superadmin_audit_log(actor_user_id, created_at desc);
create index if not exists idx_saudit_company on public.superadmin_audit_log(affected_company_id, created_at desc);
create index if not exists idx_saudit_action on public.superadmin_audit_log(action);

comment on table public.superadmin_audit_log is
  'Registro append-only de acciones de superadmin para auditoría legal y compliance.';

alter table public.superadmin_audit_log enable row level security;

-- Solo el propio superadmin puede leer/escribir; nadie más.
drop policy if exists saudit_super on public.superadmin_audit_log;
create policy saudit_super on public.superadmin_audit_log
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

notify pgrst, 'reload schema';
