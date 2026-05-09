-- =============================================================================
-- Almacenes inteligente — Fase E
-- Alertas predictivas + rotación lenta
-- =============================================================================
-- Decisiones:
--  - Las alertas se recalculan periódicamente (cron diario) o a petición.
--  - Cada alerta tiene severity y kind. El usuario puede 'descartar' una
--    alerta y reaparece si las condiciones siguen siendo verdaderas tras el
--    siguiente recálculo (lo decidiremos a futuro).
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'stock_alert_kind') then
    create type app.stock_alert_kind as enum (
      'predictive_low',     -- al ritmo actual el min se cruza antes del lead_time
      'below_min',          -- ya está en el mínimo o por debajo
      'over_max',           -- supera stock_max
      'no_rotation_90d',    -- sin salidas en 90 días
      'no_lead_time_set'    -- producto gestionado sin lead_time configurado
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'stock_alert_severity') then
    create type app.stock_alert_severity as enum ('info','warning','critical');
  end if;
  if not exists (select 1 from pg_type where typname = 'stock_alert_status') then
    create type app.stock_alert_status as enum ('active','dismissed','auto_resolved');
  end if;
end $$;

create table if not exists public.stock_alerts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  warehouse_id    uuid references public.warehouses(id) on delete cascade,
  kind            app.stock_alert_kind not null,
  severity        app.stock_alert_severity not null default 'warning',
  message         text not null,
  payload         jsonb,
  status          app.stock_alert_status not null default 'active',
  created_at      timestamptz not null default now(),
  dismissed_at    timestamptz,
  dismissed_by    uuid references auth.users(id) on delete set null,
  unique (company_id, product_id, warehouse_id, kind)
);

create index if not exists idx_stockalerts_company_status
  on public.stock_alerts(company_id, status);
create index if not exists idx_stockalerts_product
  on public.stock_alerts(product_id);

alter table public.stock_alerts enable row level security;
alter table public.stock_alerts force row level security;

drop policy if exists stockalerts_super on public.stock_alerts;
create policy stockalerts_super on public.stock_alerts for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists stockalerts_select_tenant on public.stock_alerts;
create policy stockalerts_select_tenant on public.stock_alerts for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists stockalerts_modify on public.stock_alerts;
create policy stockalerts_modify on public.stock_alerts for all to authenticated
  using (
    company_id = app.current_company_id()
    and (app.has_role('company_admin') or app.has_role('technical_director'))
  )
  with check (company_id = app.current_company_id());
