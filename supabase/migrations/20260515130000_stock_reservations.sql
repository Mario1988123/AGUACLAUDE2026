-- =============================================================================
-- Almacenes inteligente — Fase D
-- Reservas de stock al firmar contrato + trazabilidad de salidas
-- =============================================================================
-- Decisiones usuario 2026-05-09:
--  - Al firmar contrato, reservar el material en el almacén principal
--    (no en la furgoneta del técnico, porque puede haber varios técnicos
--    o no haber asignación todavía).
--  - El stock disponible para vender = warehouse_stock − SUM(reservas
--    activas) en ese almacén.
--  - Al instalar, la reserva pasa a 'fulfilled' y el outbound_install
--    queda enlazado al contract_id.
--  - Al facturar, se rellena invoice_id en los movements del contrato.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'stock_reservation_status') then
    create type app.stock_reservation_status as enum ('active','fulfilled','cancelled');
  end if;
end $$;

create table if not exists public.stock_reservations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  warehouse_id    uuid not null references public.warehouses(id) on delete restrict,
  product_id      uuid not null references public.products(id) on delete restrict,
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  quantity        integer not null check (quantity > 0),
  status          app.stock_reservation_status not null default 'active',
  reserved_at     timestamptz not null default now(),
  fulfilled_at    timestamptz,
  cancelled_at    timestamptz,
  reserved_by     uuid references auth.users(id) on delete set null,
  notes           text
);

create index if not exists idx_stockres_contract on public.stock_reservations(contract_id);
create index if not exists idx_stockres_active
  on public.stock_reservations(warehouse_id, product_id) where status = 'active';
create index if not exists idx_stockres_company on public.stock_reservations(company_id);

alter table public.stock_reservations enable row level security;
alter table public.stock_reservations force row level security;

drop policy if exists stockres_super on public.stock_reservations;
create policy stockres_super on public.stock_reservations for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists stockres_select_tenant on public.stock_reservations;
create policy stockres_select_tenant on public.stock_reservations for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists stockres_modify on public.stock_reservations;
create policy stockres_modify on public.stock_reservations for all to authenticated
  using (
    company_id = app.current_company_id()
    and (
      app.has_role('company_admin') or app.has_role('technical_director')
      or app.has_role('commercial_director') or app.has_role('installer')
    )
  )
  with check (company_id = app.current_company_id());

comment on table public.stock_reservations is
  'Reservas de stock activas por contrato. El stock disponible para vender = warehouse_stock − SUM(reservas activas).';

notify pgrst, 'reload schema';
