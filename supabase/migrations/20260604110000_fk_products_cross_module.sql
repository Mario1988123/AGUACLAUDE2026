-- =============================================================================
-- 20260604110000_fk_products_cross_module.sql
-- Fase 5 del Plan Productos v2.
--
-- Añade FK constraints donde antes había referencias "sueltas" a products.id
-- (sin foreign key formal). Con esto, si un día se intenta hacer DELETE duro
-- de un producto que está en uso, la BD lo impide o lo desreferencia
-- automáticamente, según el caso.
--
-- Comportamientos elegidos:
--   - warehouse_stock        → ON DELETE RESTRICT  (no borrar producto si tiene stock)
--   - stock_movements        → ON DELETE SET NULL  (mantener historial pero sin FK fantasma)
--   - stock_alerts           → ON DELETE CASCADE   (alertas obsoletas se borran solas)
--   - customer_equipment     → ON DELETE SET NULL  (equipo del cliente sobrevive como "modelo externo")
--   - maintenance_jobs       → ON DELETE SET NULL  (mantenimientos pasados conservan snapshot)
--
-- DEFENSIVO:
--   - Cada bloque comprueba que la columna y tabla existen antes de añadir FK.
--   - Antes de añadir RESTRICT, limpia filas huérfanas (NULL en una tabla
--     intermedia o eliminadas) para que la migración no falle.
--   - Cada ALTER es idempotente: si ya existe la constraint con el mismo
--     nombre, NO la duplica.
-- =============================================================================

-- Helper: añade FK si no existe.
create or replace function app._add_fk_to_products(
  p_table        text,
  p_column       text,
  p_constraint   text,
  p_on_delete    text  -- 'restrict' | 'set null' | 'cascade'
) returns void
language plpgsql
as $$
declare
  v_sql text;
  v_exists boolean;
begin
  -- ¿La tabla y columna existen?
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = p_table
       and column_name = p_column
  ) then
    raise notice 'Saltando FK %: tabla o columna no existe (%.%)', p_constraint, p_table, p_column;
    return;
  end if;

  -- ¿Ya existe la constraint?
  select exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
     where c.conname = p_constraint
       and t.relname = p_table
  ) into v_exists;

  if v_exists then
    raise notice 'FK ya existe: %', p_constraint;
    return;
  end if;

  v_sql := format(
    'alter table public.%I add constraint %I foreign key (%I) references public.products(id) on delete %s',
    p_table, p_constraint, p_column, p_on_delete
  );
  execute v_sql;
end;
$$;

-- 1) warehouse_stock.product_id → products.id  (RESTRICT — bloquea borrar producto con stock)
-- Limpieza previa: si hay filas con product_id que NO existe en products, las
-- borramos (son basura técnica que rompería el constraint).
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='warehouse_stock' and column_name='product_id'
  ) then
    delete from public.warehouse_stock ws
     where ws.product_id is not null
       and not exists (select 1 from public.products p where p.id = ws.product_id);
  end if;
end $$;
select app._add_fk_to_products(
  'warehouse_stock', 'product_id', 'fk_warehouse_stock_product', 'restrict'
);

-- 2) stock_movements.product_id → products.id  (SET NULL — conservamos historial)
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='stock_movements' and column_name='product_id'
  ) then
    update public.stock_movements sm
       set product_id = null
     where sm.product_id is not null
       and not exists (select 1 from public.products p where p.id = sm.product_id);
  end if;
end $$;
select app._add_fk_to_products(
  'stock_movements', 'product_id', 'fk_stock_movements_product', 'set null'
);

-- 3) stock_alerts.product_id → products.id  (CASCADE — alertas obsoletas no nos sirven)
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='stock_alerts' and column_name='product_id'
  ) then
    delete from public.stock_alerts sa
     where sa.product_id is not null
       and not exists (select 1 from public.products p where p.id = sa.product_id);
  end if;
end $$;
select app._add_fk_to_products(
  'stock_alerts', 'product_id', 'fk_stock_alerts_product', 'cascade'
);

-- 4) customer_equipment.product_id → products.id  (SET NULL)
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='customer_equipment' and column_name='product_id'
  ) then
    update public.customer_equipment ce
       set product_id = null
     where ce.product_id is not null
       and not exists (select 1 from public.products p where p.id = ce.product_id);
  end if;
end $$;
select app._add_fk_to_products(
  'customer_equipment', 'product_id', 'fk_customer_equipment_product', 'set null'
);

-- 5) maintenance_jobs.product_id → products.id  (SET NULL)
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='maintenance_jobs' and column_name='product_id'
  ) then
    update public.maintenance_jobs mj
       set product_id = null
     where mj.product_id is not null
       and not exists (select 1 from public.products p where p.id = mj.product_id);
  end if;
end $$;
select app._add_fk_to_products(
  'maintenance_jobs', 'product_id', 'fk_maintenance_jobs_product', 'set null'
);

-- Limpieza del helper (no se usa más allá de esta migración)
drop function app._add_fk_to_products(text, text, text, text);

notify pgrst, 'reload schema';
