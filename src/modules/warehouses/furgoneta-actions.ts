"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession, type SessionClaims } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { decrementStock } from "./stock-decrement";
import { adjustStockBatch } from "./adjust-stock";

/**
 * "Mi furgoneta" del técnico (plan de permisos, 2026-11-12, D5 + D6).
 *
 * El técnico NUNCA recibe cantidades: solo un color por producto
 * (verde / ámbar / gris) y, al cargar, si hay o no hay en el almacén.
 * Todo se lee y se mueve con admin, filtrando SIEMPRE por company_id y por la
 * furgoneta asignada al propio usuario (kind = 'vehicle').
 */

export type ColorStock = "verde" | "ambar" | "gris";

export interface MiFurgoneta {
  id: string;
  nombre: string;
  matricula: string | null;
}

export interface ProductoFurgoneta {
  product_id: string;
  nombre: string;
  referencia: string | null;
  estado: ColorStock;
}

export interface ProductoCarga {
  product_id: string;
  nombre: string;
  referencia: string | null;
  /** Carga: hay en el almacén. Devolución: hay en la furgoneta. Sin cifras. */
  hay: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

async function leerMiFurgoneta(admin: Admin, session: SessionClaims): Promise<MiFurgoneta | null> {
  if (!session.company_id) return null;
  const { data } = await admin
    .from("warehouses")
    .select("id, name, vehicle_plate")
    .eq("company_id", session.company_id)
    .eq("kind", "vehicle")
    .eq("assigned_user_id", session.user_id)
    .is("deleted_at", null)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const w = data as { id: string; name: string; vehicle_plate: string | null };
  return { id: w.id, nombre: w.name, matricula: w.vehicle_plate };
}

/** Almacén de origen de las cargas: el principal de la empresa (o el primero
 *  secundario). En Infinity solo hay uno (Andratx). [decide] */
async function leerAlmacenOrigen(admin: Admin, companyId: string): Promise<{ id: string; nombre: string } | null> {
  const { data } = await admin
    .from("warehouses")
    .select("id, name, kind")
    .eq("company_id", companyId)
    .in("kind", ["main", "secondary"])
    .is("deleted_at", null)
    .order("kind") // 'main' antes que 'secondary'
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const w = data as { id: string; name: string };
  return { id: w.id, nombre: w.name };
}

/** Unidades nuevas por producto en un almacén (suma de todas sus celdas). */
async function unidadesNuevas(admin: Admin, warehouseId: string): Promise<Map<string, number>> {
  const { data } = await admin
    .from("warehouse_stock")
    .select("product_id, quantity")
    .eq("warehouse_id", warehouseId)
    .eq("state", "new")
    .gt("quantity", 0)
    .limit(1000);
  const m = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ product_id: string; quantity: number }>) {
    m.set(r.product_id, (m.get(r.product_id) ?? 0) + (r.quantity ?? 0));
  }
  return m;
}

async function leerProductos(admin: Admin, companyId: string, ids?: string[]) {
  let q = admin
    .from("products")
    .select("id, name, internal_reference")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  if (ids) q = q.in("id", ids);
  const { data } = await q.order("name").limit(1000);
  return (data ?? []) as Array<{ id: string; name: string; internal_reference: string | null }>;
}

/**
 * Umbral del ámbar por producto (A2): el de la furgoneta
 * (warehouse_stock_thresholds.stock_min) pisa al del producto
 * (products.umbral_furgoneta); sin ninguno, ámbar cuando queda 1.
 */
async function leerUmbrales(
  admin: Admin,
  companyId: string,
  furgonetaId: string,
  productIds: string[],
): Promise<Map<string, number>> {
  const umbral = new Map<string, number>();
  if (productIds.length === 0) return umbral;
  // Columna nueva (migración 20261112120000): si aún no existe, se ignora.
  try {
    const { data, error } = await admin
      .from("products")
      .select("id, umbral_furgoneta")
      .eq("company_id", companyId)
      .in("id", productIds);
    if (!error) {
      for (const p of (data ?? []) as Array<{ id: string; umbral_furgoneta: number | null }>) {
        if (p.umbral_furgoneta != null) umbral.set(p.id, p.umbral_furgoneta);
      }
    }
  } catch {
    /* sin columna: umbral por defecto */
  }
  const { data: th } = await admin
    .from("warehouse_stock_thresholds")
    .select("product_id, stock_min")
    .eq("company_id", companyId)
    .eq("warehouse_id", furgonetaId)
    .in("product_id", productIds);
  for (const t of (th ?? []) as Array<{ product_id: string; stock_min: number | null }>) {
    if (t.stock_min != null) umbral.set(t.product_id, t.stock_min);
  }
  return umbral;
}

function colorDe(cantidad: number, umbral: number): ColorStock {
  if (cantidad <= 0) return "gris";
  if (cantidad <= umbral) return "ambar";
  return "verde";
}

/** Semáforo de la furgoneta del usuario. Sin cantidades. */
export async function listarMiFurgonetaSemaforo(): Promise<{
  furgoneta: MiFurgoneta | null;
  productos: ProductoFurgoneta[];
}> {
  const session = await requireSession();
  if (!session.company_id) return { furgoneta: null, productos: [] };
  const admin = createAdminClient() as Admin;
  const furgoneta = await leerMiFurgoneta(admin, session);
  if (!furgoneta) return { furgoneta: null, productos: [] };

  // Productos que la furgoneta tiene o ha tenido (fila de stock en cualquier
  // estado), para que el gris "se acabó" también salga.
  const { data: filas } = await admin
    .from("warehouse_stock")
    .select("product_id")
    .eq("company_id", session.company_id)
    .eq("warehouse_id", furgoneta.id)
    .limit(1000);
  const ids = Array.from(new Set(((filas ?? []) as Array<{ product_id: string }>).map((f) => f.product_id)));
  if (ids.length === 0) return { furgoneta, productos: [] };

  const [cant, prods, umbrales] = await Promise.all([
    unidadesNuevas(admin, furgoneta.id),
    leerProductos(admin, session.company_id, ids),
    leerUmbrales(admin, session.company_id, furgoneta.id, ids),
  ]);
  const productos = prods.map((p) => ({
    product_id: p.id,
    nombre: p.name,
    referencia: p.internal_reference,
    estado: colorDe(cant.get(p.id) ?? 0, umbrales.get(p.id) ?? 1),
  }));
  const orden: Record<ColorStock, number> = { ambar: 0, verde: 1, gris: 2 };
  productos.sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre, "es"));
  return { furgoneta, productos };
}

/**
 * Catálogo para registrar una carga (hay/no hay en el almacén) o una
 * devolución (solo lo que lleva la furgoneta). Nunca cifras.
 */
export async function listarCatalogoMovimiento(
  sentido: "carga" | "devolucion",
): Promise<{ ok: true; origen: string | null; productos: ProductoCarga[] } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const admin = createAdminClient() as Admin;
    const furgoneta = await leerMiFurgoneta(admin, session);
    if (!furgoneta) return { ok: false, error: "No tienes furgoneta asignada; habla con la oficina." };
    const almacen = await leerAlmacenOrigen(admin, session.company_id);
    if (!almacen) return { ok: false, error: "La empresa no tiene almacén principal; habla con la oficina." };

    if (sentido === "carga") {
      const [prods, enAlmacen] = await Promise.all([
        leerProductos(admin, session.company_id),
        unidadesNuevas(admin, almacen.id),
      ]);
      return {
        ok: true,
        origen: almacen.nombre,
        productos: prods.map((p) => ({
          product_id: p.id,
          nombre: p.name,
          referencia: p.internal_reference,
          hay: (enAlmacen.get(p.id) ?? 0) > 0,
        })),
      };
    }
    const enFurgo = await unidadesNuevas(admin, furgoneta.id);
    const ids = Array.from(enFurgo.keys());
    const prods = ids.length > 0 ? await leerProductos(admin, session.company_id, ids) : [];
    return {
      ok: true,
      origen: almacen.nombre,
      productos: prods.map((p) => ({
        product_id: p.id,
        nombre: p.name,
        referencia: p.internal_reference,
        hay: true,
      })),
    };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const movimientoSchema = z.object({
  sentido: z.enum(["carga", "devolucion"]),
  lineas: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        cantidad: z.number().int().positive().max(500),
      }),
    )
    .min(1, "Añade al menos un producto")
    .max(50),
});

/**
 * Registra una carga (almacén → mi furgoneta) o una devolución (mi furgoneta
 * → almacén). La furgoneta y el almacén se fijan en servidor: el navegador
 * solo manda productos y cantidades. Si no hay bastante, error genérico sin
 * decir cuánto queda. Deja rastro en loading_requests (estado entregado).
 */
export async function registrarMovimientoFurgoneta(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const companyId = session.company_id;
    const parsed = parseOrFriendly(movimientoSchema, input, "Movimiento de furgoneta");
    const admin = createAdminClient() as Admin;
    const furgoneta = await leerMiFurgoneta(admin, session);
    if (!furgoneta) return { ok: false, error: "No tienes furgoneta asignada; habla con la oficina." };
    const almacen = await leerAlmacenOrigen(admin, companyId);
    if (!almacen) return { ok: false, error: "La empresa no tiene almacén principal; habla con la oficina." };

    // Agrupar líneas repetidas del mismo producto.
    const porProducto = new Map<string, number>();
    for (const l of parsed.lineas) {
      porProducto.set(l.product_id, (porProducto.get(l.product_id) ?? 0) + l.cantidad);
    }
    const ids = Array.from(porProducto.keys());
    // Los productos deben ser de la empresa (el admin salta RLS).
    const prods = await leerProductos(admin, companyId, ids);
    if (prods.length !== ids.length) return { ok: false, error: "Hay un producto que no es de tu empresa" };
    const nombre = new Map(prods.map((p) => [p.id, p.name]));

    const origen = parsed.sentido === "carga" ? almacen.id : furgoneta.id;
    const destino = parsed.sentido === "carga" ? furgoneta.id : almacen.id;

    // Comprobar que hay bastante ANTES de mover nada. Sin cifras en el error.
    const disponible = await unidadesNuevas(admin, origen);
    for (const [pid, cant] of porProducto) {
      if ((disponible.get(pid) ?? 0) < cant) {
        return {
          ok: false,
          error:
            parsed.sentido === "carga"
              ? `No hay suficiente «${nombre.get(pid) ?? "producto"}» en el almacén; avisa a la oficina.`
              : `No llevas tanto «${nombre.get(pid) ?? "producto"}» en la furgoneta.`,
        };
      }
    }

    // Rastro: orden de carga ya entregada.
    const nowIso = new Date().toISOString();
    const { data: req, error: errReq } = await admin
      .from("loading_requests")
      .insert({
        company_id: companyId,
        source_warehouse_id: origen,
        destination_warehouse_id: destino,
        status: "delivered",
        requested_by: session.user_id,
        prepared_by: session.user_id,
        delivered_by: session.user_id,
        prepared_at: nowIso,
        delivered_at: nowIso,
        notes: parsed.sentido === "carga" ? "Carga registrada por el técnico" : "Devolución registrada por el técnico",
      })
      .select("id")
      .single();
    if (errReq) throw new Error(errReq.message);
    const requestId = (req as { id: string }).id;

    const faltas: string[] = [];
    for (const [pid, cant] of porProducto) {
      const movido = await decrementStock({
        company_id: companyId,
        warehouse_id: origen,
        product_id: pid,
        quantity: cant,
        movement_type: "transfer_out",
        loading_request_id: requestId,
        performed_by: session.user_id,
        notes: parsed.sentido === "carga" ? "Carga de furgoneta (técnico)" : "Devolución al almacén (técnico)",
      });
      if (movido > 0) {
        await adjustStockBatch(companyId, session.user_id, [
          {
            warehouse_id: destino,
            product_id: pid,
            state: "new",
            location_id: null,
            delta: movido,
            movement_type: "transfer_in",
            loading_request_id: requestId,
            notes: parsed.sentido === "carga" ? "Carga de furgoneta (técnico)" : "Devolución al almacén (técnico)",
          },
        ]);
      }
      await admin.from("loading_request_items").insert({
        loading_request_id: requestId,
        company_id: companyId,
        product_id: pid,
        quantity_requested: cant,
        quantity_prepared: movido,
        quantity_delivered: movido,
      });
      if (movido < cant) faltas.push(nombre.get(pid) ?? "producto");
    }

    revalidatePath("/mi-furgoneta");
    revalidatePath("/almacenes");
    if (faltas.length > 0) {
      return {
        ok: false,
        error: `Se movió solo una parte de: ${faltas.join(", ")}. Avisa a la oficina para que lo revise.`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
