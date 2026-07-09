# Plan: `adjustStock()` central — atomicidad de stock (Fase C, §4a)

Borrador para revisar ANTES de tocar nada. No aplica migraciones ni cambia código
todavía. Objetivo: eliminar la clase de bugs de stock replicada en 12 archivos.

---

## 1. Qué está fallando exactamente

Hoy, mutar stock son **3-5 llamadas separadas a la BD, sin transacción**, repetidas
en 12 sitios (`transfer-actions`, `stock-decrement`, `free-trials`, `uninstall`,
`purchase`, `loading-request`, `stock-count`, `import`, `inventory`, `invoices`,
`products/stock-actions`, `alert-actions`). El patrón:

```
1) SELECT warehouse_stock  (leer quantity actual)
2) UPDATE warehouse_stock SET quantity = <valor_leído> ± n   ← read-modify-write
3) UPDATE/INSERT destino (en transfer)
4) INSERT stock_movements  (log de auditoría)
```

Esto produce **tres fallos reales**:

### A. Stock evaporado (fallo parcial, sin rollback)
En `transferStockAction` (transfer-actions.ts:47-75): decrementa el origen (paso 2)
y **luego** incrementa el destino (paso 3). Si el paso 3 falla (red, constraint,
lo que sea), el stock **ya salió del origen y nunca llegó al destino** → desaparece.
No hay `BEGIN/COMMIT`, así que no se revierte el paso 2.

### B. Lost updates (concurrencia)
El paso 2 es `UPDATE ... SET quantity = <valor que leí antes> - n`. Si dos
operaciones tocan la misma celda a la vez, ambas leyeron 10, ambas escriben `10-5`,
y el resultado final es 5 en vez de 0. El `CHECK (quantity >= 0)` de la tabla **no**
protege de esto (cada escritura individual es válida). Pasa en TODOS los sitios que
hacen read-modify-write.

### C. Log de auditoría divergente
Si el paso 4 (insertar el `stock_movement`) falla **después** de haber movido el
stock, el inventario físico cambió pero **no queda constancia** del movimiento →
imposible reconciliar. Hoy en `decrementStock:117` ese fallo es solo un
`console.error` silencioso.

**Raíz común:** operaciones multi-paso sin atomicidad + `read-modify-write` no
seguro ante concurrencia.

---

## 2. Qué vamos a hacer

Mover TODA la mutación de stock a **una función Postgres** (`adjust_stock_batch`)
que corre en **una sola transacción** y hace el incremento **en la BD con bloqueo
de fila**. Esto arregla A, B y C de raíz:

- **Una transacción** → o se aplica todo o nada (mata A y C).
- **`SELECT ... FOR UPDATE` + `quantity = quantity + delta`** → sin lost updates (mata B).
- **`CHECK (quantity >= 0)`** se evalúa dentro de la tx → si un decremento no cabe,
  revierte todo el lote.

Ya usáis RPCs atómicas para casos parecidos (numeración de facturas
`next_invoice_number`, `seed_*`), así que esto es el mismo patrón.

### 2.1 La función (borrador)
```sql
-- Aplica N ajustes de stock en UNA transacción. Cada ajuste opera sobre la celda
-- (warehouse, product, state, location). delta > 0 entra, < 0 sale.
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
  adj jsonb; v_wh uuid; v_prod uuid; v_state app.stock_unit_state;
  v_loc uuid; v_delta int; v_partial bool; v_row uuid; v_cur int; v_applied int;
  v_out jsonb := '[]'::jsonb;
begin
  if p_company_id is null then raise exception 'company_id requerido'; end if;
  for adj in select value from jsonb_array_elements(p_adjustments) loop
    v_wh    := (adj->>'warehouse_id')::uuid;
    v_prod  := (adj->>'product_id')::uuid;
    v_state := coalesce(adj->>'state','new')::app.stock_unit_state;
    v_loc   := nullif(adj->>'location_id','')::uuid;
    v_delta := (adj->>'delta')::int;
    v_partial := coalesce((adj->>'allow_partial')::bool, false);

    -- Bloquea la celda → serializa concurrencia (sin lost updates)
    select id, quantity into v_row, v_cur
      from public.warehouse_stock
      where warehouse_id = v_wh and product_id = v_prod and state = v_state
        and location_id is not distinct from v_loc
      for update;
    if not found then v_cur := 0; v_row := null; end if;

    if v_delta < 0 and (v_cur + v_delta) < 0 then
      if not v_partial then
        raise exception 'INSUFFICIENT_STOCK: prod % wh % (hay %, piden %)',
          v_prod, v_wh, v_cur, -v_delta;      -- revierte TODO el lote
      end if;
      v_applied := -v_cur;                     -- modo lenient: coge lo que hay
    else
      v_applied := v_delta;
    end if;

    if v_applied <> 0 then
      if v_row is null then
        insert into public.warehouse_stock(company_id,warehouse_id,product_id,state,location_id,quantity)
          values (p_company_id, v_wh, v_prod, v_state, v_loc, v_applied);
      else
        update public.warehouse_stock
          set quantity = quantity + v_applied, updated_at = now() where id = v_row;
      end if;
      insert into public.stock_movements(
        company_id, product_id, warehouse_id, destination_warehouse_id,
        movement_type, quantity, state_after, installation_id, free_trial_id,
        maintenance_id, loading_request_id, performed_by, notes)
      values (p_company_id, v_prod, v_wh,
        nullif(adj->>'destination_warehouse_id','')::uuid,
        (adj->>'movement_type')::app.stock_movement_type, abs(v_applied), v_state,
        nullif(adj->>'installation_id','')::uuid,
        nullif(adj->>'free_trial_id','')::uuid,
        nullif(adj->>'maintenance_id','')::uuid,
        nullif(adj->>'loading_request_id','')::uuid,
        p_performed_by, adj->>'notes');
    end if;

    v_out := v_out || jsonb_build_object(
      'warehouse_id', v_wh, 'product_id', v_prod, 'requested', v_delta, 'applied', v_applied);
  end loop;
  return v_out;
end; $$;
```

### 2.2 El wrapper TS (borrador)
```ts
// src/modules/warehouses/adjust-stock.ts  — "use server"
export interface StockAdjustment {
  warehouse_id: string; product_id: string;
  state?: "new" | "used" | "damaged" | "refurbished";
  location_id?: string | null;
  delta: number;               // + entra, - sale
  movement_type: string;
  destination_warehouse_id?: string | null;
  installation_id?: string | null; free_trial_id?: string | null;
  maintenance_id?: string | null; loading_request_id?: string | null;
  notes?: string | null;
  allow_partial?: boolean;     // decrementos "lenientes" (instalación)
}
export async function adjustStockBatch(
  companyId: string, performedBy: string | null, adjustments: StockAdjustment[],
): Promise<Array<{ warehouse_id: string; product_id: string; requested: number; applied: number }>> {
  const admin = createAdminClient() as any;
  const { data, error } = await admin.rpc("adjust_stock_batch", {
    p_company_id: companyId, p_performed_by: performedBy, p_adjustments: adjustments,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}
```

### 2.3 Ejemplo: la transferencia deja de evaporar stock
```ts
// antes: 4 pasos sin tx  →  ahora: 1 llamada atómica
await adjustStockBatch(session.company_id, session.user_id, [
  { warehouse_id: from, product_id, delta: -qty, movement_type: "transfer_out",
    destination_warehouse_id: to },                 // strict: falla si no hay
  { warehouse_id: to,   product_id, delta: +qty, movement_type: "transfer_in" },
]); // si algo falla, NI el origen ni el destino cambian
```

---

## 3. La decisión que es TUYA (el trade-off)

Punto clave: **la atomicidad NO obliga a cambiar el comportamiento de negocio.** La
RPC garantiza que la *mutación de stock* es todo-o-nada; **cada llamador decide qué
hacer si falla**:

| Sitio | Política ante fallo | Cómo |
|---|---|---|
| Transferencia, compra, devolución | **Bloquear** (no quieres media operación) | `allow_partial:false`, dejar propagar el error |
| **Instalación** (cierre en campo) | **No bloquear** (mantener tu diseño actual) | `allow_partial:true` + `try/catch` que registra incidente y continúa |

Es decir: en la instalación seguimos con "el stock no tumba la finalización" (ya lo
hicimos observable en el commit 11755f2), pero **ahora la mutación en sí ya no
evapora stock ni sufre lost updates**.

**Decisiones (CONFIRMADAS 2026-07-09):**
1. **D1 — Instalación:** ✅ `allow_partial:true` + continuar (no bloquear). El fallo
   TÉCNICO (no el "falta stock" normal) se registra en `error_reports`
   (`/superadmin/errores`) y, además, avisará al admin/técnico de la empresa
   (pendiente de aplicar al migrar `decrementStock`).
2. **D2 — Multi-ubicación:** ✅ **respetar ubicaciones** (no aplanar a null). La
   función opera sobre celda concreta; el reparto entre ubicaciones lo arma el
   wrapper pasando varias celdas en el mismo lote (todas en una transacción).
3. **D3 — `contract_id`/`lot_id`:** ✅ dados por aplicados (migración
   `20260515100000`); la función los incluye normal.

**Estado (commit de esta tanda):** hechos la migración `20260709120000_adjust_stock_batch.sql`,
el wrapper `adjust-stock.ts` (+5 tests) y migrado `transferStockAction` con fallback
al camino clásico si la RPC no está. PENDIENTE por ti: aplicar la migración en un
BRANCH de Supabase y probarla; luego a prod. Después seguimos con `decrementStock`.

---

## 4. Plan de ejecución (sitio a sitio, verificando)

1. **Migración** con `adjust_stock_batch` — se prueba en un **branch de Supabase o
   staging** antes de prod (el stack local está roto por drift de migraciones).
2. **Wrapper `adjustStockBatch`** + test unitario del armado de argumentos (fake
   client, como `link-items`).
3. **Migrar `transferStockAction`** (el caso más claro de evaporación) → verificar.
4. **Migrar `decrementStock`** (instalación, `allow_partial:true`) → verificar que la
   instalación sigue sin bloquearse y el shortage se reporta igual.
5. Resto de sitios uno a uno (free-trials, uninstall, purchase, loading-request,
   stock-count, import, inventory…), manteniendo cada uno su política.
6. Los `catch` defensivos de columnas se conservan donde sigan haciendo falta.

**Verificación:** typecheck + tests del wrapper en cada paso; la RPC en staging.
Nada se toca en prod sin tu OK y sin haber probado la función en un branch.

---

## 5. Riesgos y por qué es seguro hacerlo por fases
- No puedo testear la RPC en local (stack roto) → se prueba en **branch de Supabase**.
- Migramos **un sitio cada vez**, con typecheck/tests, y el comportamiento de negocio
  (bloquear vs no) se preserva explícitamente por sitio.
- La red de **82 tests** ya cubre la lógica pura adyacente.
- Si algún paso huele mal, paramos ese sitio y lo revisamos, sin bloquear el resto.
