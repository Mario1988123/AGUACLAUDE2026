"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { esGestorStock } from "@/shared/lib/auth/role-scope";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { esTablaQueFalta } from "./filtros-carga";

/**
 * Carga de reserva de las furgonetas (oficina). Una fila sin furgoneta es la
 * reserva de toda la empresa; la de una furgoneta pisa a la de la empresa para
 * ese artículo. Solo la edita quien gestiona stock (admin y director técnico).
 * Todo con admin + company_id.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface FilaReserva {
  id: string;
  warehouse_id: string | null;
  tipo: "producto" | "filtro";
  articulo_id: string;
  nombre: string;
  cantidad: number;
}

export interface DatosReserva {
  disponible: boolean;
  furgonetas: Array<{ id: string; nombre: string }>;
  filas: FilaReserva[];
  productos: Array<{ id: string; nombre: string; referencia: string | null }>;
  filtros: Array<{ id: string; nombre: string; referencia: string | null }>;
}

async function sesionGestor() {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!esGestorStock(session)) throw new Error("Solo la oficina puede editar la carga de reserva");
  return { session, companyId: session.company_id };
}

export async function leerReservaFurgonetas(): Promise<{ ok: true; datos: DatosReserva } | { ok: false; error: string }> {
  try {
    const { companyId } = await sesionGestor();
    const admin = createAdminClient() as Admin;
    const [wh, pr, fi, rs] = await Promise.all([
      admin
        .from("warehouses")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("kind", "vehicle")
        .is("deleted_at", null)
        .order("name"),
      admin
        .from("products")
        .select("id, name, internal_reference")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("name")
        .limit(1000),
      admin
        .from("product_filters")
        .select("id, name, internal_reference")
        .eq("company_id", companyId)
        .is("deleted_at", null)
        .order("name")
        .limit(1000),
      admin
        .from("reservas_furgoneta")
        .select("id, warehouse_id, product_id, filter_id, cantidad")
        .eq("company_id", companyId)
        .limit(2000),
    ]);
    const productos = ((pr.data ?? []) as Array<{ id: string; name: string; internal_reference: string | null }>).map(
      (p) => ({ id: p.id, nombre: p.name, referencia: p.internal_reference }),
    );
    const filtros = ((fi.data ?? []) as Array<{ id: string; name: string; internal_reference: string | null }>).map(
      (f) => ({ id: f.id, nombre: f.name, referencia: f.internal_reference }),
    );
    const nP = new Map(productos.map((p) => [p.id, p.nombre]));
    const nF = new Map(filtros.map((f) => [f.id, f.nombre]));
    const disponible = !rs.error || !esTablaQueFalta(rs.error);
    if (rs.error && disponible) throw new Error(rs.error.message);
    const filas = ((rs.data ?? []) as Array<{
      id: string;
      warehouse_id: string | null;
      product_id: string | null;
      filter_id: string | null;
      cantidad: number;
    }>).map((r) => ({
      id: r.id,
      warehouse_id: r.warehouse_id,
      tipo: (r.product_id ? "producto" : "filtro") as "producto" | "filtro",
      articulo_id: (r.product_id ?? r.filter_id) as string,
      nombre: r.product_id ? nP.get(r.product_id) ?? "Producto" : nF.get(r.filter_id as string) ?? "Filtro",
      cantidad: r.cantidad,
    }));
    filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return {
      ok: true,
      datos: {
        disponible,
        furgonetas: ((wh.data ?? []) as Array<{ id: string; name: string }>).map((w) => ({ id: w.id, nombre: w.name })),
        filas,
        productos,
        filtros,
      },
    };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const guardarSchema = z.object({
  warehouse_id: z.string().uuid().nullable(),
  tipo: z.enum(["producto", "filtro"]),
  articulo_id: z.string().uuid(),
  cantidad: z.number().int().min(0).max(500),
});

/** Crea o cambia una línea de reserva (empresa o furgoneta). */
export async function guardarReservaFurgoneta(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { session, companyId } = await sesionGestor();
    const p = parseOrFriendly(guardarSchema, input, "Carga de reserva");
    const admin = createAdminClient() as Admin;

    if (p.warehouse_id) {
      const { data: w } = await admin
        .from("warehouses")
        .select("id")
        .eq("id", p.warehouse_id)
        .eq("company_id", companyId)
        .eq("kind", "vehicle")
        .is("deleted_at", null)
        .maybeSingle();
      if (!w) return { ok: false, error: "Esa furgoneta no es de tu empresa" };
    } else if (p.cantidad === 0) {
      return { ok: false, error: "En la reserva de la empresa, quita la línea en vez de ponerla a 0" };
    }
    const tabla = p.tipo === "producto" ? "products" : "product_filters";
    const { data: art } = await admin
      .from(tabla)
      .select("id")
      .eq("id", p.articulo_id)
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!art) return { ok: false, error: "Ese artículo no es de tu empresa" };

    const col = p.tipo === "producto" ? "product_id" : "filter_id";
    let q = admin.from("reservas_furgoneta").select("id").eq("company_id", companyId).eq(col, p.articulo_id);
    q = p.warehouse_id ? q.eq("warehouse_id", p.warehouse_id) : q.is("warehouse_id", null);
    const { data: existente, error: errSel } = await q.maybeSingle();
    if (errSel) throw new Error(errSel.message);
    const nowIso = new Date().toISOString();
    if (existente) {
      const { error } = await admin
        .from("reservas_furgoneta")
        .update({ cantidad: p.cantidad, updated_by: session.user_id, updated_at: nowIso })
        .eq("id", (existente as { id: string }).id)
        .eq("company_id", companyId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from("reservas_furgoneta").insert({
        company_id: companyId,
        warehouse_id: p.warehouse_id,
        product_id: p.tipo === "producto" ? p.articulo_id : null,
        filter_id: p.tipo === "filtro" ? p.articulo_id : null,
        cantidad: p.cantidad,
        updated_by: session.user_id,
      });
      if (error) throw new Error(error.message);
    }
    revalidatePath("/almacenes/reserva");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function quitarReservaFurgoneta(id: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { companyId } = await sesionGestor();
    const rid = parseOrFriendly(z.string().uuid(), id, "Línea de reserva");
    const admin = createAdminClient() as Admin;
    const { error } = await admin.from("reservas_furgoneta").delete().eq("id", rid).eq("company_id", companyId);
    if (error) throw new Error(error.message);
    revalidatePath("/almacenes/reserva");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
