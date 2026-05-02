-- =============================================================================
-- 20260502130000_contract_clauses.sql
-- Cláusulas de contrato (templates por tipo + snapshot inmutable en contrato)
-- + columnas auxiliares (deposit_cents, pending_fields).
-- Una sola tabla nueva. Cláusulas concretas usadas se guardan como jsonb
-- snapshot dentro de contracts.clauses_snapshot — congelado al firmar.
-- =============================================================================

alter table public.contracts
  add column if not exists deposit_cents     integer,
  add column if not exists clauses_snapshot  jsonb not null default '[]'::jsonb,
  add column if not exists pending_fields    text[] not null default array[]::text[];

comment on column public.contracts.clauses_snapshot is
  'Cláusulas congeladas en el momento de creación/firma. Estructura: [{title, body, display_order}]. No se reescribe si los templates cambian después.';

comment on column public.contracts.pending_fields is
  'Lista de campos pendientes (ej. iban, dni, signature). Se muestra como watermark en el PDF.';

-- -----------------------------------------------------------------------------
-- contract_clause_templates: cláusulas por defecto editables por la empresa,
-- agrupadas por tipo de contrato (cash/rental/renting).
-- -----------------------------------------------------------------------------
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

create trigger trg_clause_tpl_updated
  before update on public.contract_clause_templates
  for each row execute function app.set_updated_at();

comment on table public.contract_clause_templates is
  'Templates de cláusulas por tipo de contrato (cash/rental/renting). El admin las edita en /configuracion/contratos. Se snapshotean en contracts.clauses_snapshot al crear el contrato.';

-- RLS
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

-- =============================================================================
-- Seed: cláusulas por defecto si la empresa no tiene ninguna.
-- Llamar manualmente: select app.seed_default_clauses(company_id);
-- =============================================================================
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

  -- Cash (venta al contado)
  insert into public.contract_clause_templates (company_id, plan_type, title, body, display_order) values
    (p_company_id, 'cash', 'Garantía',
     'Los productos incluyen garantía de fabricante de 2 años desde la fecha de instalación. Cubre defectos de fabricación; no cubre daños por uso indebido, manipulación por terceros ajenos a la Empresa o mala calidad del agua de entrada fuera de especificación.',
     10),
    (p_company_id, 'cash', 'Mantenimiento',
     'El cliente es responsable del mantenimiento periódico del equipo según las indicaciones del fabricante. La Empresa ofrece servicios de mantenimiento opcionales con tarifa aparte.',
     20),
    (p_company_id, 'cash', 'Forma de pago',
     'El precio total se abonará según el plan de pagos detallado en este contrato. El impago de cualquier vencimiento facultará a la Empresa a aplicar los intereses legales correspondientes.',
     30),
    (p_company_id, 'cash', 'Protección de datos',
     'Los datos personales del Cliente serán tratados conforme al RGPD y la LOPDGDD para la gestión del contrato y servicios postventa. El Cliente puede ejercer sus derechos de acceso, rectificación, supresión, oposición y portabilidad escribiendo a la Empresa.',
     40);

  -- Rental (alquiler)
  insert into public.contract_clause_templates (company_id, plan_type, title, body, display_order) values
    (p_company_id, 'rental', 'Propiedad del equipo',
     'El equipo permanece en todo momento como propiedad de la Empresa. El Cliente lo mantiene en uso durante la vigencia del contrato a cambio de la cuota mensual pactada.',
     10),
    (p_company_id, 'rental', 'Mantenimiento incluido',
     'El alquiler incluye los mantenimientos preventivos según la periodicidad indicada en el contrato, así como la sustitución de filtros y consumibles necesarios para el correcto funcionamiento del equipo.',
     20),
    (p_company_id, 'rental', 'Cuota e impagos',
     'La cuota mensual se cobrará por domiciliación bancaria al inicio de cada mes. El impago de dos cuotas consecutivas faculta a la Empresa a retirar el equipo y resolver el contrato sin perjuicio de las cantidades adeudadas.',
     30),
    (p_company_id, 'rental', 'Permanencia y baja',
     'El contrato tiene una permanencia mínima indicada arriba. La baja anticipada conlleva el abono de las mensualidades pendientes hasta cumplir dicho periodo. Pasada la permanencia, el cliente puede causar baja con un preaviso de 30 días.',
     40),
    (p_company_id, 'rental', 'Devolución del equipo',
     'A la terminación del contrato, el Cliente facilita el acceso para retirada del equipo en su domicilio. Cualquier deterioro distinto del uso normal se descontará de la fianza, si la hubiere.',
     50),
    (p_company_id, 'rental', 'Protección de datos',
     'Los datos personales del Cliente serán tratados conforme al RGPD y la LOPDGDD. El Cliente puede ejercer sus derechos escribiendo a la Empresa.',
     60);

  -- Renting (financiera — anexo)
  insert into public.contract_clause_templates (company_id, plan_type, title, body, display_order) values
    (p_company_id, 'renting', 'Anexo a contrato de financiación',
     'Este documento constituye un ANEXO al contrato de renting que el Cliente formalizará directamente con la entidad financiera designada. La Empresa actúa exclusivamente como suministradora del equipo y prestadora del servicio técnico.',
     10),
    (p_company_id, 'renting', 'Servicio técnico',
     'Durante la vigencia del renting, la Empresa garantiza el servicio técnico, mantenimientos periódicos y reposición de consumibles según se detalla en este contrato.',
     20),
    (p_company_id, 'renting', 'Relación con la financiera',
     'Las condiciones económicas (cuotas, opciones a final de plazo, condiciones de cancelación) se rigen por el contrato firmado con la entidad financiera. Cualquier incidencia económica deberá tramitarse directamente con dicha entidad.',
     30),
    (p_company_id, 'renting', 'Devolución del equipo',
     'A la finalización del periodo de renting, salvo opción de compra ejercida con la financiera, el Cliente facilita el acceso para la retirada del equipo en su domicilio.',
     40),
    (p_company_id, 'renting', 'Protección de datos',
     'Los datos personales del Cliente serán tratados conforme al RGPD y la LOPDGDD. El Cliente autoriza expresamente la cesión de datos necesarios a la entidad financiera para la formalización y gestión del renting.',
     50);
end;
$$;

grant execute on function app.seed_default_clauses(uuid) to authenticated;
