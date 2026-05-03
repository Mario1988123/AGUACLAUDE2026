-- =============================================================================
-- 20260503140000_fix_contract_clauses.sql
-- Fix para el error "column plan_type does not exist" al ejecutar la migración
-- 20260502130000_contract_clauses.sql.
--
-- Causa: probablemente la tabla quedó a medias o con esquema antiguo.
-- Este script es idempotente y deja la tabla, índice, función y RLS correctos.
-- =============================================================================

-- 1) Asegurar columnas en contracts (idempotente)
alter table public.contracts
  add column if not exists deposit_cents     integer,
  add column if not exists clauses_snapshot  jsonb not null default '[]'::jsonb,
  add column if not exists pending_fields    text[] not null default array[]::text[];

-- 2) Tabla contract_clause_templates: si existe pero le falta plan_type, dropear y recrear
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'contract_clause_templates'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'contract_clause_templates'
        and column_name = 'plan_type'
    ) then
      drop table public.contract_clause_templates cascade;
    end if;
  end if;
end $$;

create table if not exists public.contract_clause_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  plan_type     app.pricing_plan_type not null,
  title         text not null,
  body          text not null,
  display_order integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_clause_tpl_company_plan
  on public.contract_clause_templates(company_id, plan_type, display_order)
  where is_active = true;

drop trigger if exists trg_clause_tpl_updated on public.contract_clause_templates;
create trigger trg_clause_tpl_updated
  before update on public.contract_clause_templates
  for each row execute function app.set_updated_at();

-- 3) RLS
alter table public.contract_clause_templates enable row level security;
alter table public.contract_clause_templates force row level security;

drop policy if exists clause_tpl_super on public.contract_clause_templates;
create policy clause_tpl_super on public.contract_clause_templates
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists clause_tpl_select_tenant on public.contract_clause_templates;
create policy clause_tpl_select_tenant on public.contract_clause_templates
  for select to authenticated
  using (company_id = app.current_company_id());

drop policy if exists clause_tpl_admin_write on public.contract_clause_templates;
create policy clause_tpl_admin_write on public.contract_clause_templates
  for all to authenticated
  using (company_id = app.current_company_id() and app.has_role('company_admin'))
  with check (company_id = app.current_company_id() and app.has_role('company_admin'));

-- 4) Función seed (idempotente)
create or replace function app.seed_default_clauses(p_company_id uuid)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
begin
  if exists (select 1 from public.contract_clause_templates where company_id = p_company_id) then
    return;
  end if;

  insert into public.contract_clause_templates (company_id, plan_type, title, body, display_order) values
    (p_company_id, 'cash', 'Garantía',
     'Los productos incluyen garantía de fabricante de 2 años desde la fecha de instalación.',
     10),
    (p_company_id, 'cash', 'Forma de pago',
     'El precio total se abonará según el plan de pagos detallado en este contrato.',
     20),
    (p_company_id, 'cash', 'Protección de datos',
     'Los datos personales se tratarán conforme al RGPD y la LOPDGDD.',
     30),
    (p_company_id, 'rental', 'Propiedad del equipo',
     'El equipo permanece como propiedad de la Empresa durante toda la vigencia del alquiler.',
     10),
    (p_company_id, 'rental', 'Mantenimiento incluido',
     'El alquiler incluye mantenimientos preventivos y reposición de filtros.',
     20),
    (p_company_id, 'rental', 'Cuota e impagos',
     'La cuota mensual se cobrará por domiciliación. Dos impagos consecutivos facultan a retirar el equipo.',
     30),
    (p_company_id, 'rental', 'Devolución del equipo',
     'A la terminación del contrato el Cliente facilita el acceso para retirada del equipo.',
     40),
    (p_company_id, 'renting', 'Anexo a contrato de financiación',
     'Este documento es ANEXO al contrato de renting con la entidad financiera designada.',
     10),
    (p_company_id, 'renting', 'Servicio técnico',
     'Durante el renting, la Empresa garantiza servicio técnico, mantenimientos y consumibles.',
     20),
    (p_company_id, 'renting', 'Devolución del equipo',
     'A la finalización, salvo opción de compra ejercida con la financiera, se retira el equipo.',
     30);
end;
$$;

grant execute on function app.seed_default_clauses(uuid) to authenticated;
