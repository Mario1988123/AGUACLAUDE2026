-- =============================================================================
-- 20260507200000_invoicing_verifactu.sql
-- Módulo de FACTURACIÓN compliant con Reglamento Verifactu
-- (Real Decreto 1007/2023 + Orden HAC/1177/2024 + Real Decreto 254/2025).
--
-- · Tablas: invoice_series, invoices, invoice_lines, invoice_taxes,
--   invoice_verifactu_records (hash chain), invoice_verifactu_events
--   (audit log del software), invoice_aeat_submissions (envíos a AEAT).
--
-- · Cumple con:
--   - Numeración correlativa por serie sin huecos.
--   - Encadenamiento criptográfico SHA-256 entre registros.
--   - Almacén de datos para QR (URL + parámetros AEAT).
--   - Tipos de factura: F1 (completa), F2 (simplificada), R1-R5 (rectificativas).
--   - Soporte intracomunitarias, IVA exento/reducido/normal, IRPF.
--
-- · Requiere migración previa 20260503310000_invoicing.sql (no romper compat).
-- · Idempotente: usa IF NOT EXISTS en todo.
-- =============================================================================

-- ENUMS específicos de Verifactu
do $$ begin
  if not exists (select 1 from pg_type where typname = 'invoice_type') then
    create type app.invoice_type as enum (
      'F1',  -- factura completa (art 6 RD 1619/2012)
      'F2',  -- factura simplificada (ticket, art 7)
      'F3',  -- factura emitida en sustitución de facturas simplificadas
      'R1',  -- rectificativa por error fundado en derecho y art. 80 LIVA
      'R2',  -- rectificativa por concurso de acreedores
      'R3',  -- rectificativa por créditos incobrables
      'R4',  -- rectificativa resto de causas
      'R5'   -- rectificativa de facturas simplificadas
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'invoice_status_v2') then
    create type app.invoice_status_v2 as enum (
      'draft',           -- borrador (sin numerar, editable)
      'issued',          -- emitida (numerada, hash calculado, inmutable)
      'sent_to_aeat',    -- enviada al servicio Verifactu
      'accepted_aeat',   -- aceptada por AEAT (CSV recibido)
      'rejected_aeat',   -- rechazada por AEAT (con código de error)
      'cancelled',       -- anulada (registro de anulación encadenado)
      'paid',            -- cobrada (matched contra wallet)
      'overdue'          -- vencida sin pagar
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'tax_regime') then
    create type app.tax_regime as enum (
      '01',  -- régimen general
      '02',  -- exportación
      '03',  -- bienes usados
      '04',  -- oro inversión
      '05',  -- agencias viajes
      '06',  -- grupo entidades nivel avanzado
      '07',  -- criterio de caja
      '08',  -- IPSI / IGIC
      '09',  -- facturación servicios agencias viajes
      '10',  -- cobros por cuenta de terceros
      '11',  -- arrendamiento de inmuebles sujeto a retención
      '12',  -- arrendamiento de inmuebles no sujeto a retención
      '13',  -- factura recibida por persona jurídica no establecida
      '14',  -- factura por servicios prestados por empresarios o profesionales no establecidos
      '15',  -- factura con IVA pendiente de devengo en operaciones a plazos
      '16',  -- pago anticipado por entregas intracomunitarias exentas
      '17',  -- entrega de bienes acto desempaque
      '18',  -- recargo equivalencia
      '19',  -- agricultura, ganadería, pesca
      '20',  -- régimen simplificado
      '99'   -- otros
    );
  end if;
end $$;

-- ===========================================================================
-- 1. SERIES DE FACTURACIÓN (correlativos por serie)
-- ===========================================================================
create table if not exists public.invoice_series (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  code            text not null,                     -- "A", "B", "R", "FA2026"
  name            text not null,                     -- "General 2026"
  prefix          text,                              -- prefijo opcional ej. "FAC-"
  invoice_type    app.invoice_type not null default 'F1',
  next_number     bigint not null default 1,         -- contador atómico
  year_reset      boolean not null default true,     -- resetear cada año natural
  current_year    integer not null default extract(year from now())::int,
  is_active       boolean not null default true,
  is_default      boolean not null default false,    -- serie por defecto
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, code)
);

create index if not exists idx_invoice_series_company on public.invoice_series(company_id) where is_active;

comment on table public.invoice_series is
  'Series de facturación correlativas. Verifactu exige numeración sin huecos por serie. year_reset=true → contador empieza desde 1 cada año natural.';

-- ===========================================================================
-- 2. CABECERA DE FACTURA
-- ===========================================================================
create table if not exists public.invoices (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,

  -- Identificación
  series_id                   uuid not null references public.invoice_series(id) on delete restrict,
  number                      bigint,                                        -- correlativo sin prefijo (1, 2, ...)
  reference_code              text,                                          -- ej "FAC-A-2026-0001"
  invoice_type                app.invoice_type not null default 'F1',
  status                      app.invoice_status_v2 not null default 'draft',

  -- Fechas
  issued_at                   timestamptz,                                   -- fecha de expedición
  operation_at                date,                                          -- fecha de operación
  due_at                      date,                                          -- fecha vencimiento

  -- Cliente (snapshot al emitir — no FK porque cliente puede editarse después)
  customer_id                 uuid references public.customers(id) on delete set null,
  customer_snapshot           jsonb not null default '{}'::jsonb,            -- { legal_name, tax_id, address, postal_code, city, province, country }

  -- Origen
  contract_id                 uuid references public.contracts(id) on delete set null,
  installation_id             uuid references public.installations(id) on delete set null,
  proposal_id                 uuid references public.proposals(id) on delete set null,

  -- Importes (céntimos)
  subtotal_cents              bigint not null default 0,                     -- base imponible total
  tax_total_cents             bigint not null default 0,                     -- IVA total
  retention_cents             bigint not null default 0,                     -- IRPF retenido (negativo en factura)
  total_cents                 bigint not null default 0,                     -- total a cobrar

  -- Régimen fiscal
  tax_regime                  app.tax_regime not null default '01',
  is_simplified               boolean not null default false,                -- F2/F3
  is_rectificative            boolean not null default false,                -- R1-R5
  rectifies_invoice_id        uuid references public.invoices(id) on delete restrict,
  rectification_reason        text,                                          -- motivo R1/R2/R3/R4/R5

  -- Notas / textos
  description                 text,                                          -- concepto general
  notes                       text,                                          -- notas internas
  legal_notes                 text,                                          -- notas legales que aparecen en PDF

  -- Forma de pago
  payment_method              text,                                          -- 'transferencia', 'tarjeta', 'efectivo', 'bizum', 'sepa'
  payment_iban                text,                                          -- IBAN cliente para SEPA
  paid_at                     timestamptz,
  paid_amount_cents           bigint not null default 0,

  -- VERIFACTU: hash y QR
  verifactu_hash              text,                                          -- SHA-256 del registro
  verifactu_prev_hash         text,                                          -- hash de la factura ANTERIOR de la serie (chain)
  verifactu_qr_url            text,                                          -- URL completa del QR (sede AEAT)
  verifactu_csv               text,                                          -- CSV devuelto por AEAT al aceptar
  verifactu_submitted_at      timestamptz,

  -- Auditoría
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid references auth.users(id) on delete set null,
  issued_by                   uuid references auth.users(id) on delete set null,
  cancelled_at                timestamptz,
  cancelled_by                uuid references auth.users(id) on delete set null,
  cancelled_reason            text,
  deleted_at                  timestamptz,

  unique (company_id, series_id, number)
);

create index if not exists idx_invoices_company_status on public.invoices(company_id, status) where deleted_at is null;
create index if not exists idx_invoices_customer on public.invoices(customer_id) where deleted_at is null;
create index if not exists idx_invoices_contract on public.invoices(contract_id) where contract_id is not null;
create index if not exists idx_invoices_issued_at on public.invoices(company_id, issued_at desc) where status != 'draft';
create index if not exists idx_invoices_reference on public.invoices(reference_code);

comment on table public.invoices is
  'Cabeceras de factura. Cliente y datos fiscales se guardan como snapshot al emitir (inmutable). verifactu_hash y verifactu_prev_hash forman la cadena criptográfica obligatoria por Reglamento Verifactu.';

-- ===========================================================================
-- 3. LÍNEAS DE FACTURA
-- ===========================================================================
create table if not exists public.invoice_lines (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid not null references public.invoices(id) on delete cascade,
  display_order       integer not null default 0,

  product_id          uuid references public.products(id) on delete set null,
  description         text not null,                                  -- snapshot del nombre/descripción
  quantity            numeric(12,3) not null default 1,
  unit_price_cents    bigint not null,
  discount_pct        numeric(5,2) not null default 0,
  subtotal_cents      bigint not null,                                -- (qty * unit_price) - discount
  tax_rate            numeric(5,2) not null default 21,               -- 21, 10, 4, 0
  tax_cents           bigint not null,
  retention_rate      numeric(5,2) not null default 0,                -- IRPF (15, 7, 0)
  retention_cents     bigint not null default 0,
  total_cents         bigint not null,

  -- Verifactu marca de operación por línea (suelen ir agregadas en cabecera, pero
  -- por flexibilidad permitimos override por línea)
  is_exempt           boolean not null default false,
  exempt_reason       text,                                            -- 'E1' a 'E6' segun Verifactu
  is_reverse_charge   boolean not null default false,                  -- inversión sujeto pasivo

  created_at          timestamptz not null default now()
);

create index if not exists idx_invoice_lines_invoice on public.invoice_lines(invoice_id);

-- ===========================================================================
-- 4. DESGLOSE DE IMPUESTOS (agregado por tipo)
-- ===========================================================================
create table if not exists public.invoice_taxes (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  tax_rate        numeric(5,2) not null,                          -- 21, 10, 4, 0
  base_cents      bigint not null,                                -- base imponible al tipo
  tax_cents       bigint not null,                                -- cuota IVA
  is_exempt       boolean not null default false,
  exempt_reason   text,                                           -- E1=art20, E2=art21, E3=art22, E4=art24, E5=art25, E6=otras
  created_at      timestamptz not null default now(),
  unique (invoice_id, tax_rate, is_exempt)
);

create index if not exists idx_invoice_taxes_invoice on public.invoice_taxes(invoice_id);

-- ===========================================================================
-- 5. REGISTRO VERIFACTU ENCADENADO (hash chain inmutable)
-- ===========================================================================
create table if not exists public.invoice_verifactu_records (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id) on delete cascade,
  invoice_id                  uuid not null references public.invoices(id) on delete restrict,

  -- Tipo de registro
  record_type                 text not null check (record_type in ('alta', 'anulacion')),

  -- Datos del emisor (NIF empresa)
  issuer_nif                  text not null,
  issuer_name                 text not null,

  -- Datos identificadores de la factura
  series_code                 text not null,
  invoice_number              bigint not null,
  invoice_type                app.invoice_type not null,
  issued_at                   timestamptz not null,                       -- fecha emisión
  operation_date              date not null,

  -- Cliente (puede ser null si simplificada)
  recipient_nif               text,
  recipient_name              text,
  recipient_country           text default 'ES',

  -- Importes
  base_total_cents            bigint not null,
  tax_total_cents             bigint not null,
  total_cents                 bigint not null,

  -- Cadena criptográfica (núcleo Verifactu)
  prev_hash                   text not null,                              -- hash del registro ANTERIOR
  current_hash                text not null,                              -- SHA-256 hex de este registro
  hash_algorithm              text not null default 'SHA-256',

  -- Datos para QR
  qr_url                      text not null,                              -- URL completa AEAT con parámetros
  qr_params                   jsonb not null default '{}'::jsonb,         -- { nif, numserie, fecha, importe }

  -- Estado de envío AEAT
  sent_to_aeat                boolean not null default false,
  sent_at                     timestamptz,
  aeat_response_status        text,                                       -- 'Correcto', 'AceptadoConErrores', 'Incorrecto'
  aeat_csv                    text,                                       -- código seguro verificación
  aeat_response_payload       jsonb,                                      -- respuesta completa
  aeat_error_code             text,
  aeat_error_message          text,

  created_at                  timestamptz not null default now()
);

create index if not exists idx_verifactu_company_date on public.invoice_verifactu_records(company_id, issued_at desc);
create index if not exists idx_verifactu_invoice on public.invoice_verifactu_records(invoice_id);
create index if not exists idx_verifactu_pending_aeat on public.invoice_verifactu_records(company_id, created_at)
  where sent_to_aeat = false;

comment on table public.invoice_verifactu_records is
  'Cadena criptográfica de facturas. Reglamento Verifactu obliga a encadenar cada registro con SHA-256 del anterior. INMUTABLE: nunca UPDATE ni DELETE.';

-- Bloquear UPDATE / DELETE en verifactu_records (compliance)
do $$ begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'verifactu_records_immutable'
  ) then
    execute $f$
      create or replace function public.verifactu_records_block_changes()
      returns trigger language plpgsql as $body$
      begin
        raise exception 'Los registros Verifactu son INMUTABLES (Reglamento Verifactu). No se permite UPDATE ni DELETE en invoice_verifactu_records.';
      end;
      $body$;
    $f$;
    execute 'create trigger verifactu_records_immutable
             before update or delete on public.invoice_verifactu_records
             for each row execute function public.verifactu_records_block_changes()';
  end if;
end $$;

-- ===========================================================================
-- 6. EVENTOS DEL SISTEMA INFORMÁTICO (audit log obligatorio)
-- Reglamento Verifactu obliga a registrar eventos del software:
-- arranque/parada, errores, accesos, cambios de configuración.
-- ===========================================================================
create table if not exists public.invoice_verifactu_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete set null,
  event_type      text not null,                                    -- 'startup','shutdown','error','login','config_change','invoice_create','invoice_cancel','aeat_send','aeat_response'
  severity        text not null default 'info',                     -- 'info','warning','error'
  payload         jsonb not null default '{}'::jsonb,
  user_id         uuid references auth.users(id) on delete set null,
  ip_address      inet,
  occurred_at     timestamptz not null default now()
);

create index if not exists idx_verifactu_events_company on public.invoice_verifactu_events(company_id, occurred_at desc);

-- ===========================================================================
-- 7. ENVÍOS A AEAT (cola con reintentos)
-- ===========================================================================
create table if not exists public.invoice_aeat_submissions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete cascade,
  record_id           uuid not null references public.invoice_verifactu_records(id) on delete cascade,
  attempt_number      integer not null default 1,
  status              text not null default 'pending',              -- 'pending','sending','success','failed'
  request_xml         text,                                          -- XML enviado
  response_xml        text,                                          -- XML respuesta
  error_code          text,
  error_message       text,
  sent_at             timestamptz,
  responded_at        timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_aeat_submissions_pending on public.invoice_aeat_submissions(company_id, created_at)
  where status = 'pending';

-- ===========================================================================
-- 8. CERTIFICADO FNMT por empresa (para firma envíos AEAT)
-- ===========================================================================
alter table public.company_settings
  add column if not exists verifactu_cert_alias text,                 -- alias del certificado
  add column if not exists verifactu_cert_encrypted bytea,            -- .p12 cifrado AES-256
  add column if not exists verifactu_cert_password_encrypted text,    -- password cifrado
  add column if not exists verifactu_cert_expires_at date,            -- fecha caducidad
  add column if not exists verifactu_mode text default 'no_envio'
    check (verifactu_mode in ('no_envio','verifactu','verifactu_test')),
  add column if not exists verifactu_environment text default 'production'
    check (verifactu_environment in ('production','test','sandbox'));

comment on column public.company_settings.verifactu_mode is
  'no_envio = solo registro local con QR; verifactu = envío automático a AEAT en tiempo real';

-- ===========================================================================
-- 9. RLS — facturas solo visibles para admin de empresa por defecto
-- ===========================================================================
alter table public.invoice_series enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.invoice_taxes enable row level security;
alter table public.invoice_verifactu_records enable row level security;
alter table public.invoice_verifactu_events enable row level security;
alter table public.invoice_aeat_submissions enable row level security;

-- Policies básicas: superadmin pasa siempre, dentro de la empresa solo
-- company_admin (las server actions usan admin client en la mayoría
-- de operaciones).
do $$ begin
  if not exists (select 1 from pg_policies where tablename='invoices' and policyname='invoices_super') then
    create policy invoices_super on public.invoices for all to authenticated
      using (app.is_superadmin()) with check (app.is_superadmin());
  end if;
  if not exists (select 1 from pg_policies where tablename='invoices' and policyname='invoices_admin_select') then
    create policy invoices_admin_select on public.invoices for select to authenticated
      using (
        company_id = app.current_company_id()
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = auth.uid()
            and ur.company_id = company_id
            and ur.role_key = 'company_admin'
            and ur.revoked_at is null
        )
      );
  end if;
end $$;

-- Repetir patrón super para el resto (cubierto por server actions con admin)
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'invoice_series','invoice_lines','invoice_taxes',
    'invoice_verifactu_records','invoice_verifactu_events','invoice_aeat_submissions'
  ]) loop
    execute format(
      'create policy if not exists %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())',
      t || '_super', t
    );
  end loop;
end $$;

-- ===========================================================================
-- 10. FUNCIÓN ATÓMICA para asignar siguiente número de serie
-- ===========================================================================
create or replace function public.allocate_next_invoice_number(p_series_id uuid)
returns bigint
language plpgsql
security definer
as $$
declare
  v_year integer;
  v_next bigint;
  v_series record;
begin
  select * into v_series from public.invoice_series where id = p_series_id for update;
  if not found then
    raise exception 'Serie no encontrada %', p_series_id;
  end if;

  v_year := extract(year from now())::int;

  -- Si reset anual y cambió el año → resetear contador
  if v_series.year_reset and v_series.current_year != v_year then
    update public.invoice_series
       set next_number = 1,
           current_year = v_year,
           updated_at = now()
     where id = p_series_id
     returning next_number into v_next;
  end if;

  -- Asignar y avanzar
  update public.invoice_series
     set next_number = next_number + 1,
         updated_at = now()
   where id = p_series_id
   returning next_number - 1 into v_next;

  return v_next;
end $$;

comment on function public.allocate_next_invoice_number is
  'Asigna el siguiente número correlativo de la serie de forma atómica (FOR UPDATE). Reglamento Verifactu exige numeración sin huecos por serie.';
