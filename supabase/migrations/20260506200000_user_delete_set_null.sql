-- =============================================================================
-- 20260506200000_user_delete_set_null.sql
-- Permite que un company_admin elimine PERMANENTEMENTE a un usuario sin que
-- se rompan los datos históricos. Hoy las FK críticas (signed_by_user_id,
-- collected_by_user_id, etc.) tienen NO ACTION o son NOT NULL → bloquean
-- el delete o tirarían cascadas indeseadas.
--
-- Estrategia: cambiar a ON DELETE SET NULL todas las columnas *_by/_user_id
-- que apuntan a auth.users para preservar contratos, instalaciones, eventos,
-- etc. con el campo en NULL. El email queda libre para reutilizar.
--
-- Idempotente: cada ALTER mira pg_constraint y solo aplica si la regla actual
-- no es ON DELETE SET NULL. Maneja columnas NOT NULL haciéndolas nullable
-- previamente.
-- =============================================================================

create or replace function public._fk_set_null_if_needed(
  p_table text,
  p_column text,
  p_make_nullable boolean default false
)
returns void
language plpgsql
as $$
declare
  v_conname text;
  v_referenced text;
  v_action char;
begin
  -- Localizar el FK que sale de p_table.p_column
  select c.conname,
         (select n2.nspname || '.' || cl2.relname
            from pg_class cl2
            join pg_namespace n2 on n2.oid = cl2.relnamespace
            where cl2.oid = c.confrelid) as referenced,
         c.confdeltype
    into v_conname, v_referenced, v_action
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where n.nspname = 'public'
      and t.relname = p_table
      and a.attname = p_column
      and c.contype = 'f'
    limit 1;

  if v_conname is null then
    raise notice 'FK no encontrada para %.%, salto', p_table, p_column;
    return;
  end if;

  -- Si ya es ON DELETE SET NULL ('n'), no hacemos nada
  if v_action = 'n' then
    return;
  end if;

  -- Si la columna era NOT NULL, primero la hacemos nullable
  if p_make_nullable then
    execute format('alter table public.%I alter column %I drop not null', p_table, p_column);
  end if;

  -- Drop + recreate del FK con ON DELETE SET NULL apuntando a la tabla original
  execute format('alter table public.%I drop constraint %I', p_table, v_conname);
  execute format(
    'alter table public.%I add constraint %I foreign key (%I) references %s(id) on delete set null',
    p_table, v_conname, p_column, v_referenced
  );
end $$;

-- ALTA prioridad: contratos, pagos, mantenimiento, incidencias
select public._fk_set_null_if_needed('contracts', 'signed_by_user_id', true);
select public._fk_set_null_if_needed('contracts', 'representative_user_id', true);
select public._fk_set_null_if_needed('contract_payments', 'collected_by_user_id', false);
select public._fk_set_null_if_needed('contract_payments', 'validated_by_user_id', false);
select public._fk_set_null_if_needed('maintenance_jobs', 'created_by', true);
select public._fk_set_null_if_needed('incidents', 'created_by', true);
select public._fk_set_null_if_needed('incidents', 'resolved_by', false);
select public._fk_set_null_if_needed('lost_sales', 'created_by', true);

-- MEDIA prioridad: operaciones y auditoría
select public._fk_set_null_if_needed('installation_steps_log', 'event_user_id', false);
select public._fk_set_null_if_needed('installation_photos', 'uploaded_by', false);
select public._fk_set_null_if_needed('wallet_entries', 'collected_by_user_id', false);
select public._fk_set_null_if_needed('wallet_entries', 'validated_by_user_id', false);
select public._fk_set_null_if_needed('warehouse_stock_movements', 'requested_by', true);
select public._fk_set_null_if_needed('warehouse_stock_movements', 'prepared_by', true);
select public._fk_set_null_if_needed('warehouse_stock_movements', 'delivered_by', true);
select public._fk_set_null_if_needed('price_approvals', 'requested_by_user_id', false);
select public._fk_set_null_if_needed('consents', 'recorded_by', false);

-- Tablas opcionales (silenciamos si no existen)
do $$ begin
  perform public._fk_set_null_if_needed('contract_photos', 'uploaded_by', false);
  perform public._fk_set_null_if_needed('invoices', 'created_by', true);
  perform public._fk_set_null_if_needed('parked_modules', 'approved_by', false);
exception when undefined_table then
  null;
end $$;

drop function public._fk_set_null_if_needed(text, text, boolean);

-- Permission_overrides también referencia auth.users — al eliminar al usuario,
-- los overrides se borran (lógico). Mantener CASCADE existente.

-- notifications.recipient_user_id ya está CASCADE → al borrar usuario se
-- borran sus notificaciones (lógico, son personales).
