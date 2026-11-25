-- Carga sugerida de la furgoneta (Mario 2026-11-25; plan modelo de equipo, sección 6).
--
-- Tres tablas nuevas, todas ADITIVAS (no se toca ninguna columna existente):
--
-- 1. reservas_furgoneta: la «carga de reserva», el mínimo que una furgoneta
--    debe llevar siempre. Una fila con warehouse_id NULL es la reserva de TODA
--    la empresa; una fila con warehouse_id (furgoneta) PISA la de la empresa
--    para ese artículo (cantidad 0 = esa furgoneta no lo lleva de reserva).
--    El artículo es un producto (equipo, accesorio, recambio) o un filtro.
-- 2. preferencias_carga_tecnico: cuándo carga el técnico («tarde»: al acabar
--    el día, para mañana; «manana»: antes de salir, para hoy) y si quiere que
--    el sistema le prepare la sugerencia solo (cron de la tarde).
-- 3. loading_request_filtros: líneas de FILTROS de una orden de carga
--    (loading_request_items solo admite product_id; los filtros viven en
--    product_filters / filter_stock). Hermana de loading_request_items.
--
-- La escritura la hace siempre el servidor con service_role tras comprobar el
-- rol; solo hay policies de lectura para authenticated.
-- El código funciona sin esta migración: sin tablas no hay reserva, la
-- preferencia es «tarde» sin automático y la orden lleva solo productos.

-- 1. Reserva ---------------------------------------------------------------
create table if not exists public.reservas_furgoneta (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  -- NULL = reserva de toda la empresa. Con valor: furgoneta (kind = 'vehicle').
  warehouse_id uuid references public.warehouses(id) on delete cascade,
  product_id   uuid references public.products(id) on delete cascade,
  filter_id    uuid references public.product_filters(id) on delete cascade,
  cantidad     integer not null check (cantidad >= 0 and cantidad <= 500),
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint reservas_furgoneta_un_articulo check ((product_id is null) <> (filter_id is null))
);

-- Una fila por (empresa, furgoneta o empresa entera, artículo). Con NULLs, un
-- UNIQUE normal no protege: índice de expresiones.
create unique index if not exists reservas_furgoneta_unica
  on public.reservas_furgoneta (
    company_id,
    coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(product_id,   '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(filter_id,    '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists idx_reservas_furgoneta_wh on public.reservas_furgoneta (warehouse_id);

alter table public.reservas_furgoneta enable row level security;

drop policy if exists reservas_furgoneta_super on public.reservas_furgoneta;
create policy reservas_furgoneta_super on public.reservas_furgoneta
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Lectura: la oficina de la empresa (el técnico la recibe ya calculada por el servidor).
drop policy if exists reservas_furgoneta_select on public.reservas_furgoneta;
create policy reservas_furgoneta_select on public.reservas_furgoneta
  for select to authenticated
  using (company_id = app.current_company_id() and not app.es_solo_tecnico());

comment on table public.reservas_furgoneta is
  'Carga de reserva: mínimo que la furgoneta lleva siempre. warehouse_id null = toda la empresa; con valor pisa a la de la empresa.';

-- 2. Preferencia del técnico ------------------------------------------------
create table if not exists public.preferencias_carga_tecnico (
  company_id      uuid not null references public.companies(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  momento         text not null default 'tarde' check (momento in ('tarde', 'manana')),
  sugerencia_auto boolean not null default false,
  updated_at      timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index if not exists idx_pref_carga_auto
  on public.preferencias_carga_tecnico (momento) where sugerencia_auto;

alter table public.preferencias_carga_tecnico enable row level security;

drop policy if exists preferencias_carga_tecnico_super on public.preferencias_carga_tecnico;
create policy preferencias_carga_tecnico_super on public.preferencias_carga_tecnico
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists preferencias_carga_tecnico_select on public.preferencias_carga_tecnico;
create policy preferencias_carga_tecnico_select on public.preferencias_carga_tecnico
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (user_id = auth.uid() or not app.es_solo_tecnico())
  );

comment on table public.preferencias_carga_tecnico is
  'Cuándo carga la furgoneta cada técnico (tarde = para mañana, manana = para hoy) y si quiere la sugerencia automática de la tarde.';

-- 3. Líneas de filtros de una orden de carga --------------------------------
create table if not exists public.loading_request_filtros (
  id                 uuid primary key default gen_random_uuid(),
  loading_request_id uuid not null references public.loading_requests(id) on delete cascade,
  company_id         uuid not null references public.companies(id) on delete cascade,
  filter_id          uuid not null references public.product_filters(id) on delete restrict,
  cantidad_pedida    integer not null check (cantidad_pedida > 0),
  cantidad_entregada integer check (cantidad_entregada is null or cantidad_entregada >= 0),
  created_at         timestamptz not null default now(),
  unique (loading_request_id, filter_id)
);

create index if not exists idx_lrf_company on public.loading_request_filtros (company_id);

alter table public.loading_request_filtros enable row level security;

drop policy if exists loading_request_filtros_super on public.loading_request_filtros;
create policy loading_request_filtros_super on public.loading_request_filtros
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

-- Misma regla que loading_request_items_select_tenant: el técnico solo ve las
-- de las órdenes que su RLS de loading_requests le deja ver (su furgoneta).
drop policy if exists loading_request_filtros_select on public.loading_request_filtros;
create policy loading_request_filtros_select on public.loading_request_filtros
  for select to authenticated
  using (
    company_id = app.current_company_id()
    and (
      not app.es_solo_tecnico()
      or exists (select 1 from public.loading_requests lr where lr.id = loading_request_filtros.loading_request_id)
    )
  );

-- Comprobación tras aplicar:
--   select table_name from information_schema.tables
--    where table_schema = 'public'
--      and table_name in ('reservas_furgoneta','preferencias_carga_tecnico','loading_request_filtros'); -- 3 filas
--   select tablename, count(*) from pg_policies
--    where tablename in ('reservas_furgoneta','preferencias_carga_tecnico','loading_request_filtros')
--    group by 1;  -- 2 policies cada una
