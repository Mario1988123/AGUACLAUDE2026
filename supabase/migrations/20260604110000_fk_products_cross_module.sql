-- =============================================================================
-- 20260604110000_fk_products_cross_module.sql
-- Fase 5 del Plan Productos v2 + AUDITORÍA 2026-06-04.
--
-- OBJETIVO: garantizar que TODAS las columnas que apuntan a products.id en
-- otros módulos tengan foreign key formal.
--
-- HALLAZGO de la auditoría: las migraciones originales (20260501121500
-- warehouses, 20260515140000 stock_alerts, 20260501121700 maintenance) YA
-- declararon foreign keys correctas en estas tablas. Por tanto esta
-- migración es básicamente un NO-OP de seguridad: solo añade FK si NO
-- existe ya alguna FK desde esa columna a products(id). Si ya existe, salta.
--
-- Resultado al aplicarla hoy: en una BD ya migrada con todas las tablas
-- previas, esta migración NO modifica nada. Quedará como red de seguridad
-- por si en el futuro alguien deja una columna sin FK.
--
-- maintenance_jobs ELIMINADO de la lista: NO tiene columna product_id (la
-- relación va vía customer_equipment_id).
-- =============================================================================

-- Helper: añade FK solo si NO existe ya una FK desde p_table.p_column a public.products(id).
create or replace function app._ensure_fk_to_products(
  p_table        text,
  p_column       text,
  p_constraint   text,
  p_on_delete    text  -- 'restrict' | 'set null' | 'cascade'
) returns void
language plpgsql
as $$
declare
  v_sql text;
  v_already_has_fk boolean;
begin
  -- ¿La tabla y columna existen?
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = p_table
       and column_name = p_column
  ) then
    raise notice 'Saltando FK %: la columna no existe (%.%)',
      p_constraint, p_table, p_column;
    return;
  end if;

  -- ¿Ya existe alguna FK desde esa columna que apunte a public.products(id)?
  select exists (
    select 1
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any(c.conkey)
      join pg_class t
        on t.oid = c.conrelid
       and t.relname = p_table
       and t.relnamespace = (select oid from pg_namespace where nspname = 'public')
      join pg_class ref
        on ref.oid = c.confrelid
       and ref.relname = 'products'
       and ref.relnamespace = (select oid from pg_namespace where nspname = 'public')
     where c.contype = 'f'
       and a.attname = p_column
  ) into v_already_has_fk;

  if v_already_has_fk then
    raise notice 'FK ya presente para %.%, no se añade duplicado',
      p_table, p_column;
    return;
  end if;

  v_sql := format(
    'alter table public.%I add constraint %I foreign key (%I) references public.products(id) on delete %s',
    p_table, p_constraint, p_column, p_on_delete
  );
  execute v_sql;
  raise notice 'FK añadida: % (%.%)', p_constraint, p_table, p_column;
end;
$$;

-- 1) warehouse_stock.product_id  (RESTRICT)
select app._ensure_fk_to_products(
  'warehouse_stock', 'product_id', 'fk_warehouse_stock_product', 'restrict'
);

-- 2) stock_movements.product_id  (RESTRICT — coincide con la original)
select app._ensure_fk_to_products(
  'stock_movements', 'product_id', 'fk_stock_movements_product', 'restrict'
);

-- 3) stock_alerts.product_id  (CASCADE)
select app._ensure_fk_to_products(
  'stock_alerts', 'product_id', 'fk_stock_alerts_product', 'cascade'
);

-- 4) customer_equipment.product_id  (SET NULL)
select app._ensure_fk_to_products(
  'customer_equipment', 'product_id', 'fk_customer_equipment_product', 'set null'
);

-- 5) maintenance_items_replaced.product_id  (RESTRICT — coincide con la original)
select app._ensure_fk_to_products(
  'maintenance_items_replaced', 'product_id', 'fk_mir_product', 'restrict'
);

-- 6) incidents.replacement_product_id  (SET NULL — coincide con la original)
select app._ensure_fk_to_products(
  'incidents', 'replacement_product_id', 'fk_incidents_replacement_product', 'set null'
);

-- Limpieza del helper
drop function app._ensure_fk_to_products(text, text, text, text);

notify pgrst, 'reload schema';
