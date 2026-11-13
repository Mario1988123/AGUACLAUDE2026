-- =============================================================================
-- 20261113090000_modelo_equipo_cliente.sql
-- Plan docs/PLAN_MODELO_EQUIPO_CLIENTE.md (decisiones de Mario 12-11).
--
-- M1  Tipo de equipo (fuente / osmosis) en categorías y productos.
-- M2  Variante = producto hijo de la gama (products.gama_id), un solo nivel.
-- M3  Equipo del cliente «pendiente de identificar» (puede no tener modelo,
--     solo tipo o nada) + registro de correcciones de la oficina.
-- M5  Alcance del mantenimiento de ósmosis (solo filtros / filtros + membrana).
--
-- ADITIVA e IDEMPOTENTE. No toca datos (el relleno de Infinity va aparte en
-- scripts/datos_modelo_equipo_infinity.sql, con Mario delante).
-- NO APLICADA: la aplica Mario. El código detecta si falta y oculta la función.
-- =============================================================================

-- M1 — Tipo de equipo ---------------------------------------------------------
alter table public.product_categories add column if not exists tipo_equipo text;
alter table public.products add column if not exists tipo_equipo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'product_categories_tipo_equipo_chk') then
    alter table public.product_categories add constraint product_categories_tipo_equipo_chk
      check (tipo_equipo is null or tipo_equipo in ('fuente', 'osmosis'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'products_tipo_equipo_chk') then
    alter table public.products add constraint products_tipo_equipo_chk
      check (tipo_equipo is null or tipo_equipo in ('fuente', 'osmosis'));
  end if;
end $$;

comment on column public.product_categories.tipo_equipo is
  'fuente | osmosis | null (no es equipo principal). Lo hereda el producto si no fija el suyo.';
comment on column public.products.tipo_equipo is
  'fuente | osmosis. Manda sobre el de la gama y el de la categoría (regla 0: no se mueve de categoría).';

-- M2 — Variante = producto hijo de la gama ------------------------------------
alter table public.products
  add column if not exists gama_id uuid references public.products(id) on delete restrict;
alter table public.products add column if not exists rasgos_identificacion text;

create index if not exists idx_products_gama on public.products (company_id, gama_id)
  where gama_id is not null;

comment on column public.products.gama_id is
  'Si no es null, este producto es una VARIANTE de la gama indicada (un solo nivel). Se vende la gama; la variante se fija al instalar o identificar.';
comment on column public.products.rasgos_identificacion is
  'Pista para que el técnico reconozca la variante (color, forma, grifo...).';

create or replace function public.products_gama_un_nivel()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_gama record;
begin
  if new.gama_id is null then
    return new;
  end if;
  if new.gama_id = new.id then
    raise exception 'Un producto no puede ser variante de sí mismo';
  end if;
  select id, company_id, gama_id into v_gama from public.products where id = new.gama_id;
  if not found then
    raise exception 'La gama no existe';
  end if;
  if v_gama.company_id <> new.company_id then
    raise exception 'La gama es de otra empresa';
  end if;
  if v_gama.gama_id is not null then
    raise exception 'La gama elegida ya es una variante: solo hay un nivel';
  end if;
  if exists (select 1 from public.products where gama_id = new.id) then
    raise exception 'Este producto tiene variantes: no puede ser variante de otro';
  end if;
  return new;
end $$;

drop trigger if exists trg_products_gama_un_nivel on public.products;
create trigger trg_products_gama_un_nivel
  before insert or update of gama_id on public.products
  for each row execute function public.products_gama_un_nivel();

-- M3 — Equipo del cliente pendiente de identificar ----------------------------
alter table public.customer_equipment add column if not exists tipo_equipo text;
alter table public.customer_equipment
  add column if not exists pendiente_identificar boolean not null default false;
alter table public.customer_equipment add column if not exists modelo_identificado_at timestamptz;
alter table public.customer_equipment
  add column if not exists modelo_identificado_por uuid references auth.users(id) on delete set null;
alter table public.customer_equipment add column if not exists modelo_origen text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ce_tipo_equipo_chk') then
    alter table public.customer_equipment add constraint ce_tipo_equipo_chk
      check (tipo_equipo is null or tipo_equipo in ('fuente', 'osmosis'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ce_modelo_origen_chk') then
    alter table public.customer_equipment add constraint ce_modelo_origen_chk
      check (modelo_origen is null or modelo_origen in ('alta', 'importacion', 'tecnico', 'oficina'));
  end if;
  -- El CHECK antiguo obligaba a tener EXACTAMENTE uno (producto o externo).
  -- Ahora: como mucho uno, y ninguno solo si está pendiente de identificar.
  if exists (
    select 1 from pg_constraint
     where conname = 'customer_equipment_check'
       and conrelid = 'public.customer_equipment'::regclass
  ) then
    alter table public.customer_equipment drop constraint customer_equipment_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ce_modelo_coherente') then
    alter table public.customer_equipment add constraint ce_modelo_coherente check (
      (product_id is not null)::int + (external_equipment_model_id is not null)::int <= 1
      and (pendiente_identificar or product_id is not null or external_equipment_model_id is not null)
    );
  end if;
end $$;

create index if not exists idx_ce_pendiente_identificar
  on public.customer_equipment (company_id)
  where pendiente_identificar = true and is_active = true;

comment on column public.customer_equipment.pendiente_identificar is
  'true = falta saber el modelo (o la variante si product_id es una gama con variantes). Lo resuelve el técnico al cerrar el mantenimiento o la oficina.';

-- Registro de correcciones de la oficina (decisión 5) -------------------------
create table if not exists public.correcciones_modelo_equipo (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  customer_equipment_id uuid not null references public.customer_equipment(id) on delete cascade,
  product_id_antes      uuid references public.products(id) on delete set null,
  product_id_despues    uuid references public.products(id) on delete set null,
  externo_antes         uuid references public.external_equipment_models(id) on delete set null,
  externo_despues       uuid references public.external_equipment_models(id) on delete set null,
  tipo_antes            text,
  tipo_despues          text,
  motivo                text not null check (length(btrim(motivo)) >= 3),
  corregido_por         uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists idx_cme_equipo
  on public.correcciones_modelo_equipo (customer_equipment_id, created_at desc);
create index if not exists idx_cme_company on public.correcciones_modelo_equipo (company_id);

alter table public.correcciones_modelo_equipo enable row level security;

drop policy if exists correcciones_modelo_equipo_super on public.correcciones_modelo_equipo;
create policy correcciones_modelo_equipo_super on public.correcciones_modelo_equipo
  for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin());

drop policy if exists correcciones_modelo_equipo_select on public.correcciones_modelo_equipo;
create policy correcciones_modelo_equipo_select on public.correcciones_modelo_equipo
  for select to authenticated using (company_id = app.current_company_id());
-- La escritura la hace el servidor con service_role tras comprobar que es
-- company_admin: no hay policy de insert/update/delete para authenticated.

-- M5 — Alcance del mantenimiento de ósmosis (decisiones 17 y 20) -------------
alter table public.maintenance_jobs add column if not exists alcance text;
alter table public.maintenance_jobs add column if not exists alcance_motivo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'maintenance_jobs_alcance_chk') then
    alter table public.maintenance_jobs add constraint maintenance_jobs_alcance_chk
      check (alcance is null or alcance in ('solo_filtros', 'filtros_membrana'));
  end if;
end $$;

comment on column public.maintenance_jobs.alcance is
  'Solo ósmosis: solo_filtros | filtros_membrana. Lo elige el técnico a su criterio al cerrar.';

-- Comprobación rápida tras aplicar:
--   select column_name from information_schema.columns
--    where table_name in ('customer_equipment','products','product_categories','maintenance_jobs')
--      and column_name in ('tipo_equipo','gama_id','rasgos_identificacion','pendiente_identificar',
--                          'modelo_identificado_at','modelo_identificado_por','modelo_origen',
--                          'alcance','alcance_motivo');   -- 11 filas
--   select conname from pg_constraint where conname in ('ce_modelo_coherente','customer_equipment_check');
--   -- solo ce_modelo_coherente
