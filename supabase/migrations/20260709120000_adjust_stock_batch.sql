-- =============================================================================
-- 20260709120000_adjust_stock_batch.sql
-- Mutación de stock ATÓMICA. Reemplaza el patrón repetido en ~12 archivos
-- (SELECT quantity → UPDATE read-modify-write → INSERT movement) que NO es
-- transaccional ni seguro ante concurrencia, y que provoca:
--   A) stock evaporado si falla un paso intermedio (sin rollback),
--   B) lost updates bajo concurrencia (read-modify-write),
--   C) log de auditoría divergente si falla el INSERT del movimiento.
--
-- La función aplica N ajustes en UNA transacción. Cada ajuste opera sobre una
-- CELDA de stock (warehouse, product, state, location):
--   · SELECT ... FOR UPDATE  → bloquea la celda (serializa concurrencia → mata B).
--   · quantity = quantity + delta calculado EN LA BD → atómico.
--   · delta > 0 entra, delta < 0 sale.
--   · Si un decremento no cabe:
--       - allow_partial = false → RAISE (revierte TODO el lote → mata A y C).
--       - allow_partial = true  → aplica solo lo disponible (clamp) y registra la
--                                 cantidad realmente movida (política "no bloquear").
--   · INSERT del stock_movement por la cantidad REALMENTE aplicada.
-- Devuelve jsonb [{warehouse_id, product_id, requested, applied}] para que el
-- llamador pueda reportar shortages.
--
-- ADITIVA: solo crea la función. Nada la llama hasta migrar los call-sites, y el
-- primer call-site (transferStockAction) cae al camino clásico si esta función
-- todavía no existe. Probar en un BRANCH de Supabase antes de producción.
-- =============================================================================

create or replace function public.adjust_stock_batch(
  p_company_id   uuid,
  p_performed_by uuid,
  p_adjustments  jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, app
as $$
declare
  adj       jsonb;
  v_wh      uuid;
  v_prod    uuid;
  v_state   app.stock_unit_state;
  v_loc     uuid;
  v_delta   integer;
  v_partial boolean;
  v_row     uuid;
  v_cur     integer;
  v_applied integer;
  v_out     jsonb := '[]'::jsonb;
begin
  if p_company_id is null then
    raise exception 'adjust_stock_batch: company_id requerido';
  end if;

  for adj in select value from jsonb_array_elements(coalesce(p_adjustments, '[]'::jsonb))
  loop
    v_wh      := (adj->>'warehouse_id')::uuid;
    v_prod    := (adj->>'product_id')::uuid;
    v_state   := coalesce(nullif(adj->>'state', ''), 'new')::app.stock_unit_state;
    v_loc     := nullif(adj->>'location_id', '')::uuid;
    v_delta   := (adj->>'delta')::integer;
    v_partial := coalesce((adj->>'allow_partial')::boolean, false);

    if v_wh is null or v_prod is null or v_delta is null then
      raise exception 'adjust_stock_batch: warehouse_id, product_id y delta son obligatorios';
    end if;

    -- Bloqueo de la celda (warehouse, product, state, location) → sin lost updates.
    select id, quantity into v_row, v_cur
      from public.warehouse_stock
      where warehouse_id = v_wh
        and product_id   = v_prod
        and state        = v_state
        and location_id is not distinct from v_loc
      for update;
    if not found then
      v_cur := 0;
      v_row := null;
    end if;

    -- Resolver la cantidad realmente aplicada.
    if v_delta < 0 and (v_cur + v_delta) < 0 then
      if not v_partial then
        raise exception 'INSUFFICIENT_STOCK: producto % almacen % (hay %, piden %)',
          v_prod, v_wh, v_cur, (-v_delta);
      end if;
      v_applied := -v_cur;              -- lenient: solo lo disponible
    else
      v_applied := v_delta;
    end if;

    if v_applied <> 0 then
      if v_row is null then
        insert into public.warehouse_stock(company_id, warehouse_id, product_id, state, location_id, quantity)
          values (p_company_id, v_wh, v_prod, v_state, v_loc, v_applied);
      else
        update public.warehouse_stock
          set quantity = quantity + v_applied, updated_at = now()
          where id = v_row;
      end if;

      -- Movimiento (quantity > 0 por el CHECK de la tabla → usamos abs).
      insert into public.stock_movements(
        company_id, product_id, warehouse_id, destination_warehouse_id,
        movement_type, quantity, state_after,
        installation_id, free_trial_id, maintenance_id, loading_request_id,
        contract_id, lot_id, performed_by, notes)
      values (
        p_company_id, v_prod, v_wh, nullif(adj->>'destination_warehouse_id', '')::uuid,
        (adj->>'movement_type')::app.stock_movement_type, abs(v_applied), v_state,
        nullif(adj->>'installation_id', '')::uuid,
        nullif(adj->>'free_trial_id', '')::uuid,
        nullif(adj->>'maintenance_id', '')::uuid,
        nullif(adj->>'loading_request_id', '')::uuid,
        nullif(adj->>'contract_id', '')::uuid,
        nullif(adj->>'lot_id', '')::uuid,
        p_performed_by, adj->>'notes');
    end if;

    v_out := v_out || jsonb_build_object(
      'warehouse_id', v_wh, 'product_id', v_prod,
      'requested', v_delta, 'applied', v_applied);
  end loop;

  return v_out;
end;
$$;

comment on function public.adjust_stock_batch is
  'Mutación de stock ATÓMICA (una transacción, FOR UPDATE por celda). Cada ajuste opera sobre (warehouse, product, state, location); delta>0 entra, <0 sale. allow_partial: en decrementos coge lo disponible en vez de fallar. Devuelve [{warehouse_id, product_id, requested, applied}]. Reemplaza el patrón select->update->insert no transaccional (bug de stock evaporado / lost updates).';

notify pgrst, 'reload schema';
