-- =============================================================================
-- 20261002090300_consumo_lotes_fifo_atomico.sql
--
-- Auditoría 2026-10-01, I42: consumo FIFO de lotes con leer-restar-escribir.
--
-- PROBLEMA
--   src/modules/warehouses/stock-decrement.ts leía los lotes con
--   remaining_quantity > 0 y hacía un UPDATE por lote con el valor leído
--   (remaining_quantity = leído − tomado). Dos salidas simultáneas del mismo
--   producto leían el mismo lote y una de las dos restas se perdía: el lote
--   quedaba con más unidades de las reales (valoración FIFO inflada).
--
-- ARREGLO
--   public.consume_stock_lots_fifo(company, almacén, producto, cantidad):
--   recorre los lotes del más antiguo al más nuevo con FOR UPDATE (bloqueo de
--   fila) y resta dentro de la misma transacción. Devuelve el id del primer
--   lote tocado (el que se anota en stock_movements.lot_id), o null.
--   Solo service_role (la llama el admin client desde decrementStock).
--
-- DATOS: stock_lots tiene 0 filas en producción (2026-10-02). No hay nada que
-- corregir.
--
-- Idempotente (create or replace). No toca datos.
-- =============================================================================

create or replace function public.consume_stock_lots_fifo(
  p_company_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_quantity numeric
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_restante numeric := p_quantity;
  v_toma numeric;
  v_primero uuid := null;
begin
  if p_company_id is null then
    raise exception 'consume_stock_lots_fifo: company_id obligatorio';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    return null;
  end if;

  for r in
    select id, remaining_quantity
      from public.stock_lots
     where company_id = p_company_id
       and warehouse_id = p_warehouse_id
       and product_id = p_product_id
       and remaining_quantity > 0
     order by received_at asc, created_at asc, id asc
     for update
  loop
    exit when v_restante <= 0;
    v_toma := least(r.remaining_quantity, v_restante);
    if v_toma <= 0 then
      continue;
    end if;
    update public.stock_lots
       set remaining_quantity = remaining_quantity - v_toma
     where id = r.id;
    if v_primero is null then
      v_primero := r.id;
    end if;
    v_restante := v_restante - v_toma;
  end loop;

  return v_primero;
end;
$$;

revoke all on function public.consume_stock_lots_fifo(uuid, uuid, uuid, numeric)
  from public, anon, authenticated;
grant execute on function public.consume_stock_lots_fifo(uuid, uuid, uuid, numeric)
  to service_role;

-- -----------------------------------------------------------------------------
-- warehouse_stock: una sola fila por celda TAMBIÉN cuando location_id es NULL
--
-- El UNIQUE (warehouse_id, product_id, state, location_id) es NULLS DISTINCT:
-- dos filas "montón general" (location_id NULL) del mismo producto no chocan.
-- La RPC adjust_stock_batch ya serializa con pg_advisory_xact_lock, pero los
-- caminos antiguos que aún insertan a mano (p. ej. una importación CSV hacía
-- `.eq("location_id", null)`, que nunca casa) podían duplicar la celda.
-- Postgres 17 → NULLS NOT DISTINCT.
--
-- Comprobado antes (2026-10-02), 0 filas:
--   select warehouse_id, product_id, state, location_id, count(*)
--     from public.warehouse_stock group by 1,2,3,4 having count(*) > 1;
-- -----------------------------------------------------------------------------
create unique index if not exists uq_warehouse_stock_celda_nulls_not_distinct
  on public.warehouse_stock (warehouse_id, product_id, state, location_id)
  nulls not distinct;
