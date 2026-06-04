-- =============================================================================
-- 20260604100800_product_alerts_dismissed.sql
-- Fase 1 del Plan Productos v2.
-- Registro de avisos descartados ("dar como visto") por admin a nivel de
-- producto. Hoy aplica al aviso de "atributos críticos faltantes" en la
-- ficha técnica, pero la tabla acepta alert_key libre para reutilizar la
-- mecánica en otros futuros avisos.
-- =============================================================================

create table if not exists public.product_alerts_dismissed (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  alert_key       text not null,                                    -- "missing_critical_attributes", futuros
  dismissed_at    timestamptz not null default now(),
  notes           text,
  unique (product_id, user_id, alert_key)
);

create index if not exists idx_pad_product_user on public.product_alerts_dismissed(product_id, user_id);

alter table public.product_alerts_dismissed enable row level security;
alter table public.product_alerts_dismissed force row level security;

drop policy if exists pad_super on public.product_alerts_dismissed;
create policy pad_super on public.product_alerts_dismissed
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Cada usuario lee y gestiona SOLO sus propios dismissals, dentro de la empresa.
drop policy if exists pad_self_manage on public.product_alerts_dismissed;
create policy pad_self_manage on public.product_alerts_dismissed
  for all to authenticated
  using (company_id = app.current_company_id() and user_id = auth.uid())
  with check (company_id = app.current_company_id() and user_id = auth.uid());

comment on table public.product_alerts_dismissed is
  'Avisos descartados ("Visto") por usuario para un producto y tipo de alerta. Hoy solo lo usa nivel 1 para el aviso de atributos críticos faltantes.';

notify pgrst, 'reload schema';
