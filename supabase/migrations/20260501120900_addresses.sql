-- =============================================================================
-- 20260501120900_addresses.sql
-- Capa 2 · Direcciones (modelo según owner: lead -> customer -> referenciada
-- por instalación).
--
-- Una dirección pertenece a un LEAD o a un CUSTOMER (mutuamente excluyente).
-- Cuando un lead se convierte en cliente, las direcciones se reasignan al
-- customer_id (UPDATE de columna). Las instalaciones referencian una dirección
-- del cliente vía installation.address_id.
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'address_kind') then
    create type app.address_kind as enum (
      'fiscal',         -- domicilio fiscal del cliente
      'home',           -- vivienda principal (particulares)
      'office',         -- oficina (empresas)
      'site',           -- sede / centro de trabajo
      'warehouse',      -- almacén del cliente
      'installation',   -- ubicación específica donde se instala
      'shipping',       -- envío
      'billing',        -- facturación
      'other'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'street_type') then
    create type app.street_type as enum (
      'calle','avenida','plaza','camino','carretera','urbanizacion',
      'paseo','ronda','travesia','glorieta','poligono','via','otra'
    );
  end if;
end $$;

create table public.addresses (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,

  -- Dueño (excluyente: lead_id o customer_id)
  lead_id         uuid references public.leads(id) on delete cascade,
  customer_id     uuid references public.customers(id) on delete cascade,

  -- Tipo y etiqueta
  kind            app.address_kind not null default 'home',
  label           text,                                              -- "Casa principal", "Sede Madrid", "Chalet"...
  is_primary      boolean not null default false,

  -- Persona de contacto en esta dirección (puede no ser el cliente)
  contact_name    text,
  contact_phone   text,

  -- Dirección estructurada (España)
  street_type     app.street_type default 'calle',
  street          text not null,
  street_number   text,
  portal          text,
  floor           text,
  door            text,
  postal_code     text,
  city            text,
  province        text,
  -- (no country: solo España, decisión confirmada)

  -- Geolocalización
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  -- Si la chincheta fue colocada manualmente vs. usar mi ubicación
  geo_source      text check (geo_source in ('user_pin','user_location','geocoded','none')),

  notes           text,

  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  -- Constraint: o pertenece a lead o a customer, exactamente uno
  check ((lead_id is null)::int + (customer_id is null)::int = 1)
);

create index idx_addresses_lead on public.addresses(lead_id) where lead_id is not null and deleted_at is null;
create index idx_addresses_customer on public.addresses(customer_id) where customer_id is not null and deleted_at is null;
create index idx_addresses_company on public.addresses(company_id) where deleted_at is null;
create index idx_addresses_postal on public.addresses(company_id, postal_code) where postal_code is not null;
create index idx_addresses_city on public.addresses(company_id, city) where city is not null;
-- Para encontrar fácil la "primaria" de cada dueño
create unique index uniq_address_primary_per_lead
  on public.addresses(lead_id) where lead_id is not null and is_primary = true and deleted_at is null;
create unique index uniq_address_primary_per_customer
  on public.addresses(customer_id) where customer_id is not null and is_primary = true and deleted_at is null;

create trigger trg_addresses_updated
  before update on public.addresses
  for each row execute function app.set_updated_at();

comment on table public.addresses is
  'Direcciones de leads/clientes. Cuando un lead se convierte, las direcciones se reasignan al customer_id. Una primaria por dueño.';
comment on column public.addresses.is_primary is
  'Marca la dirección principal del lead/cliente. Una única por dueño activo.';

-- =============================================================================
-- Función para "promover" un lead a customer: mueve sus direcciones
-- =============================================================================
create or replace function app.promote_lead_to_customer(
  p_lead_id uuid,
  p_customer_id uuid
) returns void
language plpgsql
security definer
set search_path = public, app
as $$
begin
  -- Validación: ambos en la misma empresa que el caller
  if not exists (
    select 1 from public.leads l
    join public.customers c on c.company_id = l.company_id
    where l.id = p_lead_id
      and c.id = p_customer_id
      and l.company_id = app.current_company_id()
  ) then
    raise exception 'Lead/customer no encontrados o no autorizados';
  end if;

  update public.addresses
     set customer_id = p_customer_id,
         lead_id = null,
         updated_at = now()
   where lead_id = p_lead_id
     and deleted_at is null;
end;
$$;

grant execute on function app.promote_lead_to_customer(uuid, uuid) to authenticated;

comment on function app.promote_lead_to_customer(uuid, uuid) is
  'Mueve todas las direcciones de un lead a un customer al convertir.';

-- =============================================================================
-- RLS — heredan visibilidad del owner (lead/customer)
-- =============================================================================
alter table public.addresses enable row level security;
alter table public.addresses force row level security;

drop policy if exists addresses_super on public.addresses;
create policy addresses_super on public.addresses
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists addresses_select_inherit on public.addresses;
create policy addresses_select_inherit on public.addresses
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and deleted_at is null
    and (
      -- Si pertenece a lead, ¿puedo ver el lead?
      (lead_id is not null and exists (
         select 1 from public.leads l
          where l.id = addresses.lead_id
            and l.company_id = app.current_company_id()
      ))
      -- Si pertenece a customer, ¿puedo ver el customer?
      or (customer_id is not null and exists (
         select 1 from public.customers c
          where c.id = addresses.customer_id
            and c.company_id = app.current_company_id()
            and c.deleted_at is null
      ))
    )
  );

drop policy if exists addresses_insert_tenant on public.addresses;
create policy addresses_insert_tenant on public.addresses
  for insert to authenticated
  with check (
    company_id = app.current_company_id()
    and (
      -- Inserción válida solo si el dueño existe en la empresa
      (lead_id is not null and exists (
         select 1 from public.leads l where l.id = addresses.lead_id and l.company_id = app.current_company_id()
      ))
      or (customer_id is not null and exists (
         select 1 from public.customers c where c.id = addresses.customer_id and c.company_id = app.current_company_id()
      ))
    )
  );

drop policy if exists addresses_update_tenant on public.addresses;
create policy addresses_update_tenant on public.addresses
  for update to authenticated
  using (company_id = app.current_company_id() and deleted_at is null)
  with check (company_id = app.current_company_id());

drop policy if exists addresses_delete_admin on public.addresses;
create policy addresses_delete_admin on public.addresses
  for delete to authenticated
  using (
    company_id = app.current_company_id()
    and app.has_role('company_admin')
  );
