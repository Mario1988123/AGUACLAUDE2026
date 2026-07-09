-- =============================================================================
-- 20260709140000_adjust_stock_batch_reason.sql
-- Amplía adjust_stock_batch (20260709120000) para que el movimiento incluya
-- `reason` y `purchase_id`, presentes en algunos call-sites (uninstall = reason,
-- purchase = purchase_id). Sin esto, migrar esos sitios perdería esos campos.
--
-- Retro-compatible: es un create or replace; los ajustes que no traigan reason/
-- purchase_id los dejan NULL (igual que hoy). El sitio #1 (transferStockAction)
-- sigue funcionando idéntico.
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

    if v_delta < 0 and (v_cur + v_delta) < 0 then
      if not v_partial then
        raise exception 'INSUFFICIENT_STOCK: producto % almacen % (hay %, piden %)',
          v_prod, v_wh, v_cur, (-v_delta);
      end if;
      v_applied := -v_cur;
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

      insert into public.stock_movements(
        company_id, product_id, warehouse_id, destination_warehouse_id,
        movement_type, quantity, state_after,
        installation_id, free_trial_id, maintenance_id, loading_request_id,
        contract_id, lot_id, purchase_id, reason, performed_by, notes)
      values (
        p_company_id, v_prod, v_wh, nullif(adj->>'destination_warehouse_id', '')::uuid,
        (adj->>'movement_type')::app.stock_movement_type, abs(v_applied), v_state,
        nullif(adj->>'installation_id', '')::uuid,
        nullif(adj->>'free_trial_id', '')::uuid,
        nullif(adj->>'maintenance_id', '')::uuid,
        nullif(adj->>'loading_request_id', '')::uuid,
        nullif(adj->>'contract_id', '')::uuid,
        nullif(adj->>'lot_id', '')::uuid,
        nullif(adj->>'purchase_id', '')::uuid,
        adj->>'reason',
        p_performed_by, adj->>'notes');
    end if;

    v_out := v_out || jsonb_build_object(
      'warehouse_id', v_wh, 'product_id', v_prod,
      'requested', v_delta, 'applied', v_applied);
  end loop;

  return v_out;
end;
$$;

notify pgrst, 'reload schema';
