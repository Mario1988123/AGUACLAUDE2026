-- ============================================================================
-- Onboarding — guía configuración inicial
-- ----------------------------------------------------------------------------
-- Decisión usuario 2026-05-19:
--   El admin tras crear empresa debe configurar muchas cosas (fiscal,
--   productos, almacenes, horarios, plantillas mailing…). Sin guía se
--   olvidan partes y luego el CRM falla por configuración incompleta.
--
-- Catálogo de pasos vive en código (`src/modules/onboarding/steps-config.ts`),
-- esta tabla solo registra QUIÉN ha completado/postpuesto qué paso.
-- ============================================================================

create table if not exists public.company_onboarding_steps (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  step_key     text not null,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  /** Fecha hasta la que el admin lo aparcó. Si > now() no aparece como
   *  pendiente. NULL = no aparcado. */
  postponed_until timestamptz,
  notes        text,
  updated_at   timestamptz not null default now(),
  unique (company_id, step_key)
);

create index if not exists idx_cos_company on public.company_onboarding_steps(company_id);

comment on table public.company_onboarding_steps is
  'Estado de pasos de onboarding del CRM por empresa. step_key referencia a un catálogo en código. completed_at marca hecho, postponed_until aparca temporalmente.';

alter table public.company_onboarding_steps enable row level security;
drop policy if exists cos_super on public.company_onboarding_steps;
create policy cos_super on public.company_onboarding_steps for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());
drop policy if exists cos_tenant on public.company_onboarding_steps;
create policy cos_tenant on public.company_onboarding_steps for all to authenticated
  using (company_id = app.current_company_id())
  with check (company_id = app.current_company_id());

notify pgrst, 'reload schema';
