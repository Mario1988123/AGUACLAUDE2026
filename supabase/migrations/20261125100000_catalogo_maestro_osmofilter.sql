-- =============================================================================
-- 20261125100000_catalogo_maestro_osmofilter.sql
-- Amplía el catálogo MAESTRO (superadmin, global) para cargar el catálogo de
-- Osmofilter completo:
--
--   1. Gamas y variantes en el maestro (catalog_products.gama_id, un nivel),
--      igual que ya existe en products de cada empresa. Cada variante sigue
--      siendo un producto con SU referencia, SU ficha y SUS fotos.
--   2. Tipo de foto (principal, ambiente, medidas, proyección, despiece...) en
--      las fotos del maestro y de la empresa, para que la ficha técnica sepa
--      cuál pintar en cada hueco.
--   3. Ventajas (título + texto + icono) del producto maestro.
--   4. Recambios ↔ equipo en el maestro (con cantidad y orden si se conocen).
--   5. Categorías globales nuevas: desincrustadores, hidrogenadores y recambios.
--
-- ADITIVA E IDEMPOTENTE: no modifica ni borra nada existente. No toca
-- catalog_products.version, así que NO salta ningún aviso a las empresas.
-- =============================================================================

-- 1) Gamas y variantes ---------------------------------------------------------
alter table public.catalog_products
  add column if not exists gama_id uuid references public.catalog_products(id) on delete restrict;
alter table public.catalog_products
  add column if not exists rasgos_identificacion text;

create index if not exists idx_catalog_products_gama
  on public.catalog_products (gama_id) where gama_id is not null;

comment on column public.catalog_products.gama_id is
  'Si no es null, este producto maestro es una VARIANTE de la gama indicada (un solo nivel). Al importar se recrea la gama en la empresa (products.gama_id).';
comment on column public.catalog_products.rasgos_identificacion is
  'Qué distingue a la variante (color, capacidad, con/sin bomba...).';

create or replace function public.catalog_products_gama_un_nivel()
returns trigger language plpgsql as $$
declare
  v_gama record;
begin
  if new.gama_id is null then
    return new;
  end if;
  if new.gama_id = new.id then
    raise exception 'Un producto no puede ser variante de sí mismo';
  end if;
  select id, gama_id into v_gama from public.catalog_products where id = new.gama_id;
  if not found then
    raise exception 'La gama no existe';
  end if;
  if v_gama.gama_id is not null then
    raise exception 'La gama elegida ya es una variante: solo hay un nivel';
  end if;
  if exists (select 1 from public.catalog_products where gama_id = new.id) then
    raise exception 'Este producto tiene variantes: no puede ser variante de otro';
  end if;
  return new;
end $$;

drop trigger if exists trg_catalog_products_gama_un_nivel on public.catalog_products;
create trigger trg_catalog_products_gama_un_nivel
  before insert or update of gama_id on public.catalog_products
  for each row execute function public.catalog_products_gama_un_nivel();

-- 2) Tipo de foto ----------------------------------------------------------------
alter table public.catalog_product_photos
  add column if not exists tipo_foto text;
alter table public.product_images
  add column if not exists tipo_foto text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'catalog_product_photos_tipo_foto_check') then
    alter table public.catalog_product_photos
      add constraint catalog_product_photos_tipo_foto_check check (tipo_foto is null or tipo_foto in
        ('principal','ambiente','medidas','ficha','banner','proyeccion','detalle','despiece'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_images_tipo_foto_check') then
    alter table public.product_images
      add constraint product_images_tipo_foto_check check (tipo_foto is null or tipo_foto in
        ('principal','ambiente','medidas','ficha','banner','proyeccion','detalle','despiece'));
  end if;
end $$;

comment on column public.catalog_product_photos.tipo_foto is
  'Hueco de la ficha: principal | ambiente | medidas | ficha | banner | proyeccion | detalle | despiece. Null = foto suelta (las de antes).';
comment on column public.product_images.tipo_foto is
  'Copiado del maestro al importar. Null = foto subida a mano por la empresa.';

-- 3) Ventajas --------------------------------------------------------------------
create table if not exists public.catalog_product_highlights (
  id                  uuid primary key default gen_random_uuid(),
  catalog_product_id  uuid not null references public.catalog_products(id) on delete cascade,
  titulo              text not null,
  descripcion         text,
  icon_path           text,                    -- bucket "catalog-global"
  display_order       integer not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists idx_cph_product
  on public.catalog_product_highlights (catalog_product_id);

comment on table public.catalog_product_highlights is
  'Ventajas del producto maestro (texto breve + texto largo + icono). Al importar se copian a products.datasheet_extra.features.';

-- 4) Recambios ↔ equipo ----------------------------------------------------------
create table if not exists public.catalog_product_compatibilities (
  id                     uuid primary key default gen_random_uuid(),
  spare_part_catalog_id  uuid not null references public.catalog_products(id) on delete cascade,
  equipment_catalog_id   uuid not null references public.catalog_products(id) on delete cascade,
  cantidad               integer check (cantidad is null or cantidad > 0),
  display_order          integer not null default 0,
  notes                  text,
  created_at             timestamptz not null default now(),
  unique (spare_part_catalog_id, equipment_catalog_id),
  check (spare_part_catalog_id <> equipment_catalog_id)
);

create index if not exists idx_cpc_equipment
  on public.catalog_product_compatibilities (equipment_catalog_id);

comment on table public.catalog_product_compatibilities is
  'Qué recambios y consumibles lleva cada equipo del maestro. Al importar se recrea en product_compatibilities de la empresa cuando tiene los dos productos.';

-- RLS: solo superadmin, igual que el resto del maestro -----------------------------
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'catalog_product_highlights', 'catalog_product_compatibilities'
  ]::text[]) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for all to authenticated using (app.is_superadmin()) with check (app.is_superadmin())', t || '_super', t);
  end loop;
end $$;

-- 5) Categorías globales nuevas (no toca las existentes) -------------------------
insert into public.product_categories_global (key, parent_key, name_es, description_es, default_kind, icon, sort_order, is_active)
values
  ('descalers',   null, 'Desincrustadores', 'Equipos antical sin sal (desincrustadores).',                 'equipment',  'zap',     75, true),
  ('hydrogen',    null, 'Hidrogenadores',   'Equipos de agua hidrogenada.',                                'equipment',  'droplets', 85, true),
  ('spare_parts', null, 'Recambios',        'Recambios y consumibles de los equipos (filtros, membranas, piezas).', 'spare_part', 'wrench', 95, true)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
