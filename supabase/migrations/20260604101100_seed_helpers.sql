-- =============================================================================
-- 20260604101100_seed_helpers.sql
-- Fase 1 del Plan Productos v2.
-- Funciones helper para que admin de cada empresa pueda IMPORTAR el seed
-- estándar del sector agua a su catálogo local. La llamada se hará desde
-- la app (Fase 2: botón "Importar categorías estándar del agua" en /productos
-- y "Importar servicios estándar" en /configuracion/productos).
--
-- Las funciones son SECURITY DEFINER para poder insertar en tablas con RLS
-- restrictivas, pero validan que el caller es company_admin de la empresa
-- destino.
-- =============================================================================

-- =============================================================================
-- 1) Clonar TODAS las categorías globales del sector agua a la empresa.
--    Idempotente: salta las que ya tiene la empresa con el mismo nombre.
-- =============================================================================
create or replace function app.import_global_water_categories(p_company_id uuid)
returns table (
  inserted_count integer,
  skipped_count  integer
)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_user_id      uuid := auth.uid();
  v_inserted     integer := 0;
  v_skipped      integer := 0;
  v_category_id  uuid;
  v_parent_id    uuid;
  r              record;
begin
  -- Guardia: el caller debe ser admin de la empresa destino (o superadmin).
  if not app.is_superadmin() then
    if v_user_id is null
       or p_company_id is null
       or p_company_id <> app.current_company_id()
       or not app.has_role('company_admin') then
      raise exception 'Solo el administrador de la empresa puede importar categorías.';
    end if;
  end if;

  -- Primera pasada: insertar categorías PADRE (sin parent).
  for r in
    select id, key, name_es, description_es, default_kind, icon, sort_order
      from public.product_categories_global
     where parent_key is null and is_active = true
     order by sort_order
  loop
    if exists (
      select 1 from public.product_categories
       where company_id = p_company_id and name = r.name_es
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.product_categories
      (company_id, cloned_from_global_id, name, description, default_kind, icon, sort_order, is_active, created_by)
    values
      (p_company_id, r.id, r.name_es, r.description_es, r.default_kind, r.icon, r.sort_order, true, v_user_id);

    v_inserted := v_inserted + 1;
  end loop;

  -- Segunda pasada: subcategorías (parent_key NOT NULL).
  for r in
    select g.id, g.key, g.parent_key, g.name_es, g.description_es, g.default_kind, g.icon, g.sort_order
      from public.product_categories_global g
     where g.parent_key is not null and g.is_active = true
     order by g.sort_order
  loop
    if exists (
      select 1 from public.product_categories
       where company_id = p_company_id and name = r.name_es
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Resolver parent_id local a partir del nombre del padre global.
    select pc.id into v_parent_id
      from public.product_categories pc
      join public.product_categories_global pcg
        on pcg.key = r.parent_key
     where pc.company_id = p_company_id
       and pc.name = pcg.name_es
     limit 1;

    insert into public.product_categories
      (company_id, cloned_from_global_id, parent_id, name, description, default_kind, icon, sort_order, is_active, created_by)
    values
      (p_company_id, r.id, v_parent_id, r.name_es, r.description_es, r.default_kind, r.icon, r.sort_order, true, v_user_id);

    v_inserted := v_inserted + 1;
  end loop;

  return query select v_inserted, v_skipped;
end;
$$;

revoke all on function app.import_global_water_categories(uuid) from public;
grant execute on function app.import_global_water_categories(uuid) to authenticated;

comment on function app.import_global_water_categories(uuid) is
  'Clona el seed global de categorías del sector agua a la empresa indicada. Idempotente. Solo admin de la empresa o superadmin.';

-- =============================================================================
-- 2) Sembrar las "líneas de servicio" estándar del sector
--    (horas trabajo, desplazamiento, mantenimientos a cuota plana).
--    Estas líneas son `products` con kind='service' bajo la categoría
--    "Servicio" de la empresa.
-- =============================================================================
create or replace function app.import_standard_service_lines(p_company_id uuid)
returns table (
  inserted_count integer,
  skipped_count  integer
)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_user_id           uuid := auth.uid();
  v_service_cat_id    uuid;
  v_inserted          integer := 0;
  v_skipped           integer := 0;
  r                   record;
begin
  if not app.is_superadmin() then
    if v_user_id is null
       or p_company_id is null
       or p_company_id <> app.current_company_id()
       or not app.has_role('company_admin') then
      raise exception 'Solo el administrador de la empresa puede importar servicios estándar.';
    end if;
  end if;

  -- Localizar la categoría "Servicio" de la empresa.
  select id into v_service_cat_id
    from public.product_categories
   where company_id = p_company_id
     and (name = 'Servicio' or name = 'service')
   limit 1;

  if v_service_cat_id is null then
    raise exception 'La empresa no tiene la categoría "Servicio". Importa primero las categorías estándar.';
  end if;

  for r in
    select * from (values
      ('Hora de trabajo técnico',          'Tiempo facturable de instalación, reparación o mantenimiento.'),
      ('Desplazamiento por km',            'Coste por kilómetro de desplazamiento al cliente.'),
      ('Mantenimiento de ósmosis',         'Mantenimiento periódico de equipo de ósmosis (cuota plana).'),
      ('Mantenimiento de descalcificador', 'Mantenimiento periódico de equipo de descalcificación (cuota plana).')
    ) as defaults(svc_name, svc_desc)
  loop
    if exists (
      select 1 from public.products
       where company_id = p_company_id
         and name = r.svc_name
         and deleted_at is null
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into public.products
      (company_id, category_id, kind, name, short_description, is_active, stock_managed, created_by)
    values
      (p_company_id, v_service_cat_id, 'service'::app.product_kind, r.svc_name, r.svc_desc, true, false, v_user_id);

    v_inserted := v_inserted + 1;
  end loop;

  return query select v_inserted, v_skipped;
end;
$$;

revoke all on function app.import_standard_service_lines(uuid) from public;
grant execute on function app.import_standard_service_lines(uuid) to authenticated;

comment on function app.import_standard_service_lines(uuid) is
  'Crea 4 líneas de servicio estándar (hora trabajo, desplazamiento, mantenimientos planos) bajo la categoría Servicio. Idempotente. Solo admin de la empresa o superadmin.';

notify pgrst, 'reload schema';
