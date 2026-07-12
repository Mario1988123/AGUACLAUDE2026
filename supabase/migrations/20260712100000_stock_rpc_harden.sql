-- =============================================================================
-- 20260712100000_stock_rpc_harden.sql
-- Endurecimiento de las RPC de stock tras auditoría (2026-07-12). Corrige:
--
-- C1 (CRÍTICO seguridad): las funciones en `public` NO tenían `revoke execute`,
--     así que Supabase las exponía a `authenticated`/`anon` vía PostgREST. Un
--     usuario autenticado podía llamar /rest/v1/rpc/adjust_stock_batch con un
--     warehouse_id de OTRA empresa y mutar su stock saltándose RLS. Fix: revoke
--     de public/anon/authenticated + grant solo a service_role, y validación de
--     que el warehouse pertenece a p_company_id dentro de la función.
--
-- C2 (CRÍTICO robustez): la carrera de "primera celda" con location_id NULL
--     (UNIQUE es NULLS DISTINCT, FOR UPDATE no bloquea filas inexistentes) creaba
--     filas duplicadas que luego rompen `.maybeSingle()`. Fix: pg_advisory_xact_lock
--     por celda antes del SELECT → serializa la creación concurrente.
--
-- M1: validar movement_type (es NOT NULL en el INSERT). M2: decrement_stock_spread
--     con guard de p_company_id null.
--
-- create or replace: retro-compatible con los 4 call-sites ya migrados.
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

    -- M1: movement_type es obligatorio (NOT NULL en el INSERT del movimiento).
    if v_wh is null or v_prod is null or v_delta is null or (adj->>'movement_type') is null then
      raise exception 'adjust_stock_batch: warehouse_id, product_id, delta y movement_type son obligatorios';
    end if;

    -- C1: el warehouse DEBE pertenecer a la empresa indicada (defensa en profundidad
    -- por si se llamara con service_role y un warehouse_id ajeno).
    perform 1 from public.warehouses w where w.id = v_wh and w.company_id = p_company_id;
    if not found then
      raise exception 'adjust_stock_batch: el almacen % no pertenece a la empresa %', v_wh, p_company_id;
    end if;

    -- C2: serializa por celda (warehouse, product, state, location) para evitar la
    -- carrera de primer INSERT que duplicaría filas (el UNIQUE es NULLS DISTINCT y
    -- FOR UPDATE no bloquea una fila que aún no existe).
    perform pg_advisory_xact_lock(
      hashtextextended(
        v_wh::text || '|' || v_prod::text || '|' || v_state::text || '|' || coalesce(v_loc::text, ''),
        0
      )
    );

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

create or replace function public.decrement_stock_spread(
  p_company_id   uuid,
  p_warehouse_id uuid,
  p_product_id   uuid,
  p_state        app.stock_unit_state,
  p_quantity     integer
) returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  r           record;
  v_remaining integer := p_quantity;
  v_take      integer;
  v_moved     integer := 0;
begin
  -- M2: guard de company_id (simetría con adjust_stock_batch).
  if p_company_id is null then
    raise exception 'decrement_stock_spread: company_id requerido';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    return 0;
  end if;

  for r in
    select id, quantity
      from public.warehouse_stock
      where company_id  = p_company_id
        and warehouse_id = p_warehouse_id
        and product_id   = p_product_id
        and state        = p_state
        and quantity     > 0
      order by quantity desc
      for update
  loop
    exit when v_remaining <= 0;
    v_take := least(r.quantity, v_remaining);
    if v_take <= 0 then continue; end if;
    update public.warehouse_stock
      set quantity = quantity - v_take, updated_at = now()
      where id = r.id;
    v_remaining := v_remaining - v_take;
    v_moved     := v_moved + v_take;
  end loop;

  return v_moved;
end;
$$;

-- C1: solo service_role puede ejecutar estas RPC (el wrapper usa admin client =
-- service_role). Nunca directamente desde el navegador vía PostgREST.
revoke execute on function public.adjust_stock_batch(uuid, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.adjust_stock_batch(uuid, uuid, jsonb) to service_role;

revoke execute on function public.decrement_stock_spread(uuid, uuid, uuid, app.stock_unit_state, integer) from public, anon, authenticated;
grant  execute on function public.decrement_stock_spread(uuid, uuid, uuid, app.stock_unit_state, integer) to service_role;

notify pgrst, 'reload schema';
