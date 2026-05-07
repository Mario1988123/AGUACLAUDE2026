-- =============================================================================
-- Módulo de gastos comerciales con OCR
-- =============================================================================
-- Sector tratamiento de aguas. Comercial técnico sube tickets desde móvil con
-- OCR (Mindee). Admin/director aprueba. Distingue tarjeta empresa (validar) vs
-- dinero personal (validar + liquidar via reembolso). Compliance ES: factura
-- simplificada vs completa, IVA deducible, dietas IRPF.
-- =============================================================================

-- 1. Categorías (configurables por tenant; sembramos un set base)
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,                          -- transport, fuel, parking, lodging, meal_self, meal_client, gift, office, technical, training, other
  name text not null,
  group_code text not null,                    -- A_transport | B_lodging | C_food | D_representation | E_office | F_technical | G_training | H_other
  accounting_account text,                     -- 6240, 6270, etc. (PGC España)
  vat_deductible boolean not null default true,  -- false en comidas con cliente
  irpf_exempt_logic text,                      -- "per_diem_overnight", "per_diem_no_overnight", "kilometers", null
  default_max_amount_cents integer,            -- alerta superado (no bloquea)
  requires_client_link boolean not null default false,
  is_active boolean not null default true,
  display_order integer not null default 100,
  icon text,                                   -- lucide icon name
  created_at timestamptz not null default now(),
  unique(company_id, code)
);
create index if not exists expense_categories_company_idx on public.expense_categories(company_id);
alter table public.expense_categories enable row level security;

-- 2. Gastos
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.user_accounts(id) on delete restrict, -- comercial que sube
  category_id uuid references public.expense_categories(id) on delete set null,

  -- Datos extraídos del ticket (OCR + revisión)
  merchant_name text,
  merchant_nif text,
  merchant_address text,
  issue_date date,
  document_type text not null default 'ticket_simple',  -- ticket_simple | invoice_simple_qualified | invoice_full
  document_number text,
  total_cents integer not null check (total_cents >= 0),
  base_cents integer,                          -- base imponible
  vat_cents integer,                           -- cuota IVA total
  vat_breakdown jsonb,                         -- [{rate:21,base:1000,amount:210}, ...]
  currency text not null default 'EUR',

  -- Pago
  payment_method text not null default 'personal',     -- corp_card | personal | cash
  corp_card_last4 text,                                -- si corp_card

  -- Contexto comercial
  customer_id uuid references public.customers(id) on delete set null,  -- gasto atribuible a cliente CRM
  contract_id uuid references public.contracts(id) on delete set null,
  installation_id uuid references public.installations(id) on delete set null,
  notes text,

  -- Storage del recibo + OCR
  receipt_storage_path text,                   -- path en bucket "expenses"
  receipt_mime text,
  ocr_provider text,                           -- mindee | manual
  ocr_raw jsonb,
  ocr_confidence numeric(4,3),

  -- Workflow
  status text not null default 'submitted',    -- draft | submitted | approved | rejected | reimbursed | reconciled
  submitted_at timestamptz default now(),
  approved_by_user_id uuid references public.user_accounts(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  reimbursed_at timestamptz,
  reimbursed_amount_cents integer,
  reimbursement_notes text,
  bank_transaction_ref text,

  -- Compliance
  policy_violations jsonb,                     -- [{rule:"daily_meal_limit", severity:"warn"}]
  is_irpf_exempt boolean default true,         -- false si excede límites dieta
  irpf_taxable_cents integer,                  -- importe que tributa

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_company_idx on public.expenses(company_id);
create index if not exists expenses_user_idx on public.expenses(user_id);
create index if not exists expenses_status_idx on public.expenses(status);
create index if not exists expenses_issue_date_idx on public.expenses(issue_date desc);
create index if not exists expenses_customer_idx on public.expenses(customer_id) where customer_id is not null;
alter table public.expenses enable row level security;

-- 3. Dietas (per diem) — separado porque su lógica IRPF es propia
create table if not exists public.expense_per_diems (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.user_accounts(id) on delete restrict,
  trip_purpose text,
  customer_id uuid references public.customers(id) on delete set null,
  date date not null,
  with_overnight boolean not null default false,
  scope text not null default 'national',      -- national | eu | international
  destination text,
  daily_amount_exempt_cents integer not null,  -- exento IRPF según RD 439/2007
  status text not null default 'submitted',    -- submitted | approved | rejected | reimbursed
  approved_by_user_id uuid references public.user_accounts(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  reimbursed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expense_per_diems_user_idx on public.expense_per_diems(user_id);
create index if not exists expense_per_diems_date_idx on public.expense_per_diems(date desc);
alter table public.expense_per_diems enable row level security;

-- 4. Kilometraje (separado: cálculo automático km × tarifa)
create table if not exists public.expense_mileage (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.user_accounts(id) on delete restrict,
  date date not null,
  origin text,
  destination text,
  km integer not null check (km > 0),
  rate_cents_per_km integer not null default 26,  -- 0.26€/km exento IRPF
  total_cents integer not null,
  customer_id uuid references public.customers(id) on delete set null,
  contract_id uuid references public.contracts(id) on delete set null,
  installation_id uuid references public.installations(id) on delete set null,
  vehicle_plate text,
  status text not null default 'submitted',
  approved_by_user_id uuid references public.user_accounts(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  reimbursed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expense_mileage_user_idx on public.expense_mileage(user_id);
create index if not exists expense_mileage_date_idx on public.expense_mileage(date desc);
alter table public.expense_mileage enable row level security;

-- 5. Settings de la empresa para gastos
create table if not exists public.expense_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  ocr_provider text default 'mindee',
  per_diem_overnight_cents integer default 5334,        -- 53.34€ RD 439/2007
  per_diem_no_overnight_cents integer default 2667,     -- 26.67€
  per_diem_eu_overnight_cents integer default 9135,
  per_diem_eu_no_overnight_cents integer default 4808,
  km_rate_cents integer default 26,
  daily_meal_alert_cents integer default 5000,           -- alerta si comida sin pernocta > 50€
  approval_threshold_auto_cents integer default 0,       -- 0 = nada auto-aprobado
  require_client_link_above_cents integer default 10000, -- pedir cliente si > 100€
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.expense_settings enable row level security;

-- 6. Triggers updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_expenses_updated on public.expenses;
create trigger trg_expenses_updated before update on public.expenses
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_expense_per_diems_updated on public.expense_per_diems;
create trigger trg_expense_per_diems_updated before update on public.expense_per_diems
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_expense_mileage_updated on public.expense_mileage;
create trigger trg_expense_mileage_updated before update on public.expense_mileage
  for each row execute function public.touch_updated_at();
drop trigger if exists trg_expense_settings_updated on public.expense_settings;
create trigger trg_expense_settings_updated before update on public.expense_settings
  for each row execute function public.touch_updated_at();

-- 7. RLS — server actions usan admin client. Solo super tiene policies.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'expense_categories','expenses','expense_per_diems','expense_mileage','expense_settings'
  ]) loop
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())',
      t || '_super', t
    );
  end loop;
end $$;

-- 8. Sembrar categorías por defecto cuando se crea empresa
-- (lo haremos via trigger o action a demanda; aquí el catálogo base
-- como referencia para la UI)
create or replace function public.seed_expense_categories(p_company uuid)
returns void language plpgsql as $$
begin
  insert into public.expense_categories (company_id, code, name, group_code, accounting_account, vat_deductible, irpf_exempt_logic, default_max_amount_cents, requires_client_link, display_order, icon)
  values
    (p_company, 'fuel', 'Combustible', 'A_transport', '62210', true, null, null, false, 10, 'Fuel'),
    (p_company, 'mileage', 'Kilometraje', 'A_transport', '64500', false, 'kilometers', null, false, 11, 'Car'),
    (p_company, 'tolls', 'Peajes', 'A_transport', '62800', true, null, null, false, 12, 'CircleDot'),
    (p_company, 'parking', 'Parking', 'A_transport', '62800', true, null, null, false, 13, 'ParkingCircle'),
    (p_company, 'taxi', 'Taxi / VTC', 'A_transport', '62900', true, null, null, false, 14, 'CarTaxiFront'),
    (p_company, 'public_transport', 'Transporte público', 'A_transport', '62900', true, null, null, false, 15, 'TrainFront'),
    (p_company, 'plane', 'Avión', 'A_transport', '62900', true, null, null, false, 17, 'Plane'),
    (p_company, 'rental_car', 'Alquiler vehículo', 'A_transport', '62150', true, null, null, false, 18, 'CarFront'),
    (p_company, 'hotel', 'Hotel / Alojamiento', 'B_lodging', '62900', true, null, null, false, 20, 'Hotel'),
    (p_company, 'meal_self', 'Comida del comercial', 'C_food', '64900', true, 'per_diem_no_overnight', 2667, false, 30, 'UtensilsCrossed'),
    (p_company, 'meal_client', 'Comida con cliente', 'C_food', '62700', false, null, null, true, 31, 'Users'),
    (p_company, 'gift_client', 'Atención / regalo a cliente', 'D_representation', '62700', false, null, null, true, 40, 'Gift'),
    (p_company, 'event', 'Evento / feria', 'D_representation', '62900', true, null, null, false, 41, 'Calendar'),
    (p_company, 'office_material', 'Material de oficina', 'E_office', '62900', true, null, null, false, 50, 'PencilRuler'),
    (p_company, 'phone', 'Telefonía / datos', 'E_office', '62920', true, null, null, false, 51, 'Phone'),
    (p_company, 'shipping', 'Mensajería / sellos', 'E_office', '62900', true, null, null, false, 52, 'Package'),
    (p_company, 'tech_parts', 'Repuestos campo', 'F_technical', '60290', true, null, null, false, 60, 'Wrench'),
    (p_company, 'tech_ppe', 'EPI / consumibles', 'F_technical', '60240', true, null, null, false, 61, 'HardHat'),
    (p_company, 'tech_tools', 'Herramientas menores', 'F_technical', '60240', true, null, null, false, 62, 'Hammer'),
    (p_company, 'tech_lab', 'Análisis agua / laboratorio', 'F_technical', '62300', true, null, null, false, 63, 'FlaskConical'),
    (p_company, 'training', 'Formación / cursos', 'G_training', '62930', true, null, null, false, 70, 'GraduationCap'),
    (p_company, 'bank_fee', 'Comisiones bancarias', 'H_other', '62600', false, null, null, false, 90, 'Landmark'),
    (p_company, 'other', 'Otros', 'H_other', '62900', true, null, null, false, 100, 'MoreHorizontal')
  on conflict (company_id, code) do nothing;
end $$;
