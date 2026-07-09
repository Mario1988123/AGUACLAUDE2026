-- =============================================================================
-- 20260709130000_decrement_stock_spread.sql
-- Descuento de stock ATÓMICO repartido por ubicaciones, para el sitio #2
-- (decrementStock / instalaciones).
--
-- Reemplaza SOLO el bucle "leer filas → update quantity = leído - take" de
-- decrementStock, que sufría LOST UPDATES bajo concurrencia (read-modify-write).
-- Esta función recorre las celdas 'p_state' del (warehouse, product)
-- BLOQUEÁNDOLAS (FOR UPDATE) y descuenta de mayor a menor hasta cubrir la
-- cantidad — o lo que haya (es LENIENT por naturaleza: nunca falla, mueve lo que
-- puede, como hoy). Devuelve la cantidad realmente movida.
--
-- Deliberadamente NO toca stock_lots ni inserta el stock_movement: eso se queda
-- en JS tal cual (lots FIFO + movimiento agregado con lot_id), para no cambiar el
-- comportamiento ni perder la trazabilidad de lotes. Aquí solo se arregla el
-- descuento de la cantidad vendible (warehouse_stock), que es lo que sufría el bug.
--
-- ADITIVA. Si la función no existe (migración sin aplicar), decrementStock cae al
-- bucle clásico → nunca peor que hoy.
-- =============================================================================

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

comment on function public.decrement_stock_spread is
  'Descuento de stock ATÓMICO repartido por ubicaciones (FOR UPDATE por celda). Lenient: mueve lo que puede y devuelve la cantidad movida. Reemplaza el bucle read-modify-write de decrementStock (arregla lost updates). NO toca lots ni stock_movements (eso queda en JS).';

notify pgrst, 'reload schema';
