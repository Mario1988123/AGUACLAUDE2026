-- ============================================================================
-- Fase 3 módulo Financieras
-- ----------------------------------------------------------------------------
-- Una financiera ofrece renting (Grenke: N cuotas + 1 cuota residual %)
-- o financiación pura (Credibox, Pepper, Sabadell…). Tiene una tabla de
-- coeficientes por plazo (12/24/36/48/60 meses) usada para calcular qué
-- percibe la empresa: cuota_cliente = capital_empresa × coeficiente.
--
-- Decisiones usuario:
--  · renting estricto solo para empresas/autónomos
--  · financiación: cada financiera marca qué tipos de cliente acepta
--  · coeficientes editables por plazo (no por tramo de importe)
--  · capital empresa puede editarse a mano en la propuesta (scoring)
-- ============================================================================

create table if not exists public.financiers (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,

  -- Identidad
  name                        text not null,
  short_name                  text,                                          -- alias para listados
  logo_url                    text,
  notes                       text,

  -- Modalidad de la financiera
  kind                        text not null
    check (kind in ('renting_strict', 'financing')),

  -- Residual (solo renting_strict). % sobre el importe total que paga la
  -- empresa o el cliente al final como cuota nº N+1 para quedarse con el
  -- equipo. Suele ser 2-3 %.
  residual_pct                numeric(6,3)
    check (residual_pct is null or (residual_pct >= 0 and residual_pct <= 100)),

  -- Reserva retenida por la financiera durante la operación. Se paga al
  -- inicio menos esta reserva y la financiera la libera al final del
  -- contrato (o no, depende de la financiera).
  reserve_pct                 numeric(6,3)
    check (reserve_pct is null or (reserve_pct >= 0 and reserve_pct <= 100)),

  -- Tipos de cliente aceptados. renting_strict NO admite individual (por
  -- ley fiscal española) — el check lo refuerza.
  accepts_individual          boolean not null default false,
  accepts_autonomo            boolean not null default true,
  accepts_company             boolean not null default true,

  -- Estado
  is_active                   boolean not null default true,
  sort_order                  integer not null default 0,

  created_at                  timestamptz not null default now(),
  created_by                  uuid references auth.users(id) on delete set null,
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,

  -- renting_strict ⇒ no admite particulares
  check (
    kind <> 'renting_strict' or accepts_individual = false
  ),
  unique (company_id, name)
);

create index if not exists idx_financiers_company on public.financiers(company_id)
  where deleted_at is null;
create index if not exists idx_financiers_active on public.financiers(company_id, is_active)
  where deleted_at is null;

create trigger trg_financiers_updated
  before update on public.financiers
  for each row execute function app.set_updated_at();

comment on table public.financiers is
  'Financieras con las que la empresa opera renting o financiación. Una por empresa, tabla de coeficientes en financier_coefficients.';

-- Tabla de coeficientes por plazo.
create table if not exists public.financier_coefficients (
  id                          uuid primary key default gen_random_uuid(),
  financier_id                uuid not null references public.financiers(id) on delete cascade,
  term_months                 integer not null check (term_months > 0),
  -- cuota_cliente = capital_empresa × coefficient
  coefficient                 numeric(10,6) not null check (coefficient > 0),
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (financier_id, term_months)
);

create index if not exists idx_financier_coef on public.financier_coefficients(financier_id);

create trigger trg_financier_coef_updated
  before update on public.financier_coefficients
  for each row execute function app.set_updated_at();

-- RLS por company_id (heredado del padre).
alter table public.financiers enable row level security;
alter table public.financier_coefficients enable row level security;

drop policy if exists fin_select on public.financiers;
create policy fin_select on public.financiers
  for select to authenticated
  using (company_id = app.current_company_id() and deleted_at is null);

drop policy if exists fin_admin_all on public.financiers;
create policy fin_admin_all on public.financiers
  for all to authenticated
  using (
    company_id = app.current_company_id()
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role_key in ('superadmin','company_admin','commercial_director','technical_director')
    )
  )
  with check (company_id = app.current_company_id());

drop policy if exists fin_super on public.financiers;
create policy fin_super on public.financiers
  for all to authenticated
  using (app.is_superadmin())
  with check (app.is_superadmin());

drop policy if exists fincoef_select on public.financier_coefficients;
create policy fincoef_select on public.financier_coefficients
  for select to authenticated
  using (
    exists (
      select 1 from public.financiers f
       where f.id = financier_coefficients.financier_id
         and f.company_id = app.current_company_id()
         and f.deleted_at is null
    )
  );

drop policy if exists fincoef_admin on public.financier_coefficients;
create policy fincoef_admin on public.financier_coefficients
  for all to authenticated
  using (
    exists (
      select 1 from public.financiers f
       where f.id = financier_coefficients.financier_id
         and f.company_id = app.current_company_id()
    )
  )
  with check (
    exists (
      select 1 from public.financiers f
       where f.id = financier_coefficients.financier_id
         and f.company_id = app.current_company_id()
    )
  );

-- Módulo catálogo
insert into public.modules_catalog (key, label_es, description_es, icon, default_active, is_core, is_parked, sort_order)
values ('financiers', 'Financieras', 'Renting y financiación de ventas', 'banknote', true, false, false, 155)
on conflict (key) do update set
  label_es = excluded.label_es,
  description_es = excluded.description_es,
  default_active = excluded.default_active,
  is_parked = excluded.is_parked,
  sort_order = excluded.sort_order;

notify pgrst, 'reload schema';
