-- =============================================================================
-- 20260501121200_proposals.sql
-- Capa 2 · Módulo Propuestas.
--
-- DECISIÓN #2: propuestas inmutables. Editar = nueva versión, anterior pasa
-- a status='superseded'. Trazabilidad por parent_proposal_id autoreferencial.
--
-- Tablas:
--   - proposals
--   - proposal_items                   productos en la propuesta
--   - proposal_payment_options         opciones de pago ofrecidas (cash/renting/rental)
--   - proposal_versions                vista de árbol de versiones (opcional)
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'proposal_status') then
    create type app.proposal_status as enum (
      'draft',         -- borrador, no enviada
      'active',        -- versión actual
      'sent',          -- enviada al cliente
      'accepted',      -- aceptada por cliente
      'rejected',      -- rechazada por cliente
      'superseded',    -- reemplazada por nueva versión
      'expired'        -- caducada (validity_until pasada)
    );
  end if;
end $$;

create table public.proposals (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,

  -- Dueño: lead o customer (mutuamente excluyente)
  lead_id             uuid references public.leads(id) on delete restrict,
  customer_id         uuid references public.customers(id) on delete restrict,

  -- Versionado (decisión #2)
  parent_proposal_id  uuid references public.proposals(id) on delete set null,
  version_number      integer not null default 1,

  -- Estado
  status              app.proposal_status not null default 'draft',
  reference_code      text,                                            -- "P-2026-0001" generado por trigger

  -- Fechas
  validity_until      date,
  sent_at             timestamptz,
  accepted_at         timestamptz,
  rejected_at         timestamptz,
  rejected_reason     text,
  superseded_at       timestamptz,
  superseded_by_id    uuid references public.proposals(id) on delete set null,

  -- Totales (calculados al guardar — denormalizados para listings rápidos)
  total_cash_cents            integer,
  monthly_renting_min_cents   integer,
  monthly_renting_max_cents   integer,
  monthly_rental_cents        integer,

  -- Metadatos
  notes               text,
  internal_notes      text,                                            -- visibles solo internamente
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,

  check ((lead_id is null)::int + (customer_id is null)::int = 1)
);

create index idx_proposals_company_status on public.proposals(company_id, status) where deleted_at is null;
create index idx_proposals_customer on public.proposals(company_id, customer_id) where customer_id is not null and deleted_at is null;
create index idx_proposals_lead on public.proposals(company_id, lead_id) where lead_id is not null and deleted_at is null;
create index idx_proposals_created_by on public.proposals(company_id, created_by, created_at desc);
create index idx_proposals_parent on public.proposals(parent_proposal_id) where parent_proposal_id is not null;

create trigger trg_proposals_updated
  before update on public.proposals
  for each row execute function app.set_updated_at();

comment on table public.proposals is
  'Propuestas comerciales inmutables. Editar = nueva versión via parent_proposal_id.';

-- proposal_items
create table public.proposal_items (
  id                  uuid primary key default gen_random_uuid(),
  proposal_id         uuid not null references public.proposals(id) on delete cascade,
  company_id          uuid not null references public.companies(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete restrict,
  quantity            integer not null default 1 check (quantity > 0),
  -- Snapshot de datos del producto al momento de generar (inmutable)
  product_name_snapshot text not null,
  unit_price_cash_cents integer,                                      -- snapshot
  notes               text,
  display_order       integer not null default 0
);

create index idx_pi_proposal on public.proposal_items(proposal_id);

-- proposal_payment_options
create table public.proposal_payment_options (
  id                      uuid primary key default gen_random_uuid(),
  proposal_id             uuid not null references public.proposals(id) on delete cascade,
  company_id              uuid not null references public.companies(id) on delete cascade,
  plan_type               app.pricing_plan_type not null,
  duration_months         integer,
  monthly_cents           integer check (monthly_cents is null or monthly_cents >= 0),
  total_cents             integer not null check (total_cents >= 0),
  permanence_months       integer,
  -- Pagos asociados al plan (fianza, instalación, primera cuota...)
  deposit_cents           integer not null default 0,
  installation_fee_cents  integer not null default 0,
  first_payment_cents     integer,
  -- Mantenimientos incluidos
  maintenance_included    boolean not null default false,
  maintenance_months_included integer,
  maintenance_periodicity_months integer,
  maintenance_extra_cents integer,
  -- Estado
  is_recommended          boolean not null default false,
  display_order           integer not null default 0,
  -- Si requirió aprobación de precio bajo mínimo
  required_price_approval boolean not null default false,
  price_approval_id       uuid,                                       -- FK forward a price_approvals
  notes                   text
);

create index idx_ppo_proposal on public.proposal_payment_options(proposal_id);

-- =============================================================================
-- Trigger: al cambiar status de una propuesta a 'active', si tiene padre
-- marcamos al padre como 'superseded'.
-- =============================================================================
create or replace function app.proposals_handle_supersede() returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if NEW.status = 'active' and NEW.parent_proposal_id is not null then
    update public.proposals
       set status = 'superseded',
           superseded_at = now(),
           superseded_by_id = NEW.id
     where id = NEW.parent_proposal_id
       and status not in ('superseded','rejected','expired');
  end if;
  return NEW;
end;
$$;

create trigger trg_proposals_supersede
  after insert or update of status on public.proposals
  for each row
  when (NEW.status = 'active')
  execute function app.proposals_handle_supersede();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.proposals enable row level security;
alter table public.proposals force row level security;

drop policy if exists proposals_super on public.proposals;
create policy proposals_super on public.proposals for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists proposals_select_by_scope on public.proposals;
create policy proposals_select_by_scope on public.proposals
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      app.can('proposals','view','all_company')
      or (app.can('proposals','view','department') and app.in_department('sales'))
      or (app.can('proposals','view','own') and created_by = auth.uid())
    )
  );

drop policy if exists proposals_insert_by_scope on public.proposals;
create policy proposals_insert_by_scope on public.proposals
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and (
      app.can('proposals','create','all_company')
      or app.can('proposals','create','department')
      or app.can('proposals','create','own')
    )
  );

-- Update solo si está en estado modificable (draft) y por owner/admin/director
drop policy if exists proposals_update_draft on public.proposals;
create policy proposals_update_draft on public.proposals
  for update to authenticated
  using (
    company_id = app.current_company_id()
    and status in ('draft')
    and (
      app.can('proposals','update','all_company')
      or (app.can('proposals','update','department') and app.in_department('sales'))
      or (app.can('proposals','update','own') and created_by = auth.uid())
    )
  )
  with check (company_id = app.current_company_id());

-- proposal_items y proposal_payment_options: heredan visibilidad
do $$
declare t text;
begin
  for t in select unnest(array['proposal_items','proposal_payment_options']::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
    execute format('drop policy if exists %I on public.%I', t || '_inherit', t);
    execute format('create policy %I on public.%I for all to authenticated using (company_id = app.current_company_id() and exists (select 1 from public.proposals p where p.id = %I.proposal_id and p.company_id = app.current_company_id())) with check (company_id = app.current_company_id())', t || '_inherit', t, t);
  end loop;
end $$;
