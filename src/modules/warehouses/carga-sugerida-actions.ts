"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { claveDiaMadrid, sumarDiasClave } from "@/modules/scheduling/fechas-madrid";
import { lineasConfirmadas } from "./carga-sugerida-logica";
import {
  ESTADOS_ABIERTOS,
  NOTA_SUGERENCIA,
  calcularSugerencia,
  crearOrdenSugerida,
  leerAlmacenOrigen,
  leerFurgonetaDe,
  type SugerenciaCarga,
} from "./carga-sugerida-datos";
import { deliverLoadingRequestAction } from "./loading-request-actions";

/**
 * Carga sugerida de la furgoneta, para el propio técnico (Mario 2026-11-25).
 * La furgoneta, el almacén y el día se fijan en servidor: el navegador solo
 * dice «hoy» o «mañana» y, al pedirla, las cantidades que quiere cargar.
 * Pedirla crea una orden de carga «solicitada» (no mueve stock); el stock se
 * mueve al confirmar la carga, con el flujo de órdenes de carga de siempre.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const diaSchema = z.enum(["hoy", "manana"]);

function claveDe(dia: "hoy" | "manana"): string {
  const hoy = claveDiaMadrid(new Date());
  return dia === "hoy" ? hoy : sumarDiasClave(hoy, 1);
}

export async function verMiCargaSugerida(
  dia: unknown,
): Promise<{ ok: true; sugerencia: SugerenciaCarga } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const d = parseOrFriendly(diaSchema, dia, "Día de carga");
    const admin = createAdminClient() as Admin;
    const r = await calcularSugerencia(admin, session.company_id, session.user_id, claveDe(d));
    if ("error" in r) return { ok: false, error: r.error };
    return { ok: true, sugerencia: r };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const pedirSchema = z.object({
  dia: diaSchema,
  /** Si ya hay una sugerencia sin preparar para ese día, se anula y se rehace. */
  reemplazar: z.boolean().optional(),
  lineas: z
    .array(
      z.object({
        tipo: z.enum(["producto", "filtro"]),
        id: z.string().uuid(),
        cantidad: z.number().int().min(0).max(500),
      }),
    )
    .min(1, "Añade al menos un artículo")
    .max(100),
});

export async function pedirMiCargaSugerida(
  input: unknown,
): Promise<{ ok: true; aviso: string | null } | { ok: false; error: string; yaExiste?: boolean }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const companyId = session.company_id;
    const parsed = parseOrFriendly(pedirSchema, input, "Carga sugerida");
    const lineas = lineasConfirmadas(parsed.lineas);
    if (lineas.length === 0) return { ok: false, error: "No hay nada que cargar" };
    const admin = createAdminClient() as Admin;

    const furgoneta = await leerFurgonetaDe(admin, companyId, session.user_id);
    if (!furgoneta) return { ok: false, error: "No tienes furgoneta asignada; habla con la oficina." };
    const origen = await leerAlmacenOrigen(admin, companyId);
    if (!origen) return { ok: false, error: "La empresa no tiene almacén principal; habla con la oficina." };

    // Los artículos deben ser de la empresa (el admin salta RLS).
    const pIds = lineas.filter((l) => l.tipo === "producto").map((l) => l.id);
    const fIds = lineas.filter((l) => l.tipo === "filtro").map((l) => l.id);
    const [pr, fr] = await Promise.all([
      pIds.length ? admin.from("products").select("id").eq("company_id", companyId).is("deleted_at", null).in("id", pIds) : { data: [] },
      fIds.length ? admin.from("product_filters").select("id").eq("company_id", companyId).is("deleted_at", null).in("id", fIds) : { data: [] },
    ]);
    if (((pr.data ?? []) as unknown[]).length !== pIds.length || ((fr.data ?? []) as unknown[]).length !== fIds.length) {
      return { ok: false, error: "Hay un artículo que no es de tu empresa" };
    }

    const dia = claveDe(parsed.dia);
    // Una sola orden abierta por furgoneta y día.
    const { data: abiertas } = await admin
      .from("loading_requests")
      .select("id, status, notes")
      .eq("company_id", companyId)
      .eq("destination_warehouse_id", furgoneta.id)
      .eq("needed_for", dia)
      .in("status", ESTADOS_ABIERTOS as unknown as string[]);
    const lista = (abiertas ?? []) as Array<{ id: string; status: string; notes: string | null }>;
    if (lista.length > 0) {
      const reemplazables = lista.filter((o) => o.status === "requested" && (o.notes ?? "").startsWith(NOTA_SUGERENCIA));
      if (!parsed.reemplazar || reemplazables.length !== lista.length) {
        return {
          ok: false,
          yaExiste: reemplazables.length === lista.length,
          error:
            reemplazables.length === lista.length
              ? "Ya tienes una carga pedida para ese día. ¿Quieres sustituirla por esta?"
              : "El almacén ya está preparando tu carga de ese día; habla con la oficina para cambiarla.",
        };
      }
      // Compare-and-set: solo si sigue «solicitada» (el almacén no la ha cogido).
      const { data: anuladas } = await admin
        .from("loading_requests")
        .update({ status: "cancelled" })
        .eq("company_id", companyId)
        .in("id", reemplazables.map((o) => o.id))
        .eq("status", "requested")
        .select("id");
      if (((anuladas ?? []) as unknown[]).length !== reemplazables.length) {
        return { ok: false, error: "El almacén acaba de empezar a preparar tu carga; habla con la oficina." };
      }
    }

    const r = await crearOrdenSugerida(admin, {
      companyId,
      userId: session.user_id,
      furgonetaId: furgoneta.id,
      origenId: origen.id,
      dia,
      lineas,
      automatica: false,
    });
    revalidatePath("/mi-furgoneta");
    revalidatePath("/almacenes");
    return {
      ok: true,
      aviso:
        r.filtrosOmitidos > 0
          ? `Los filtros (${r.filtrosOmitidos}) no caben aún en la orden de carga: cógelos con «Registrar carga».`
          : null,
    };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * «Ya lo he cargado»: el técnico confirma su orden y se mueve el stock
 * (almacén → su furgoneta). Reutiliza deliverLoadingRequestAction, que ya
 * comprueba que el destino sea SU furgoneta y hace compare-and-set.
 */
export async function confirmarMiCarga(requestId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const id = parseOrFriendly(z.string().uuid(), requestId, "Orden de carga");
    await deliverLoadingRequestAction(id);
    revalidatePath("/mi-furgoneta");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/** El técnico anula SU sugerencia mientras siga «solicitada». */
export async function anularMiCargaSugerida(requestId: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const id = parseOrFriendly(z.string().uuid(), requestId, "Orden de carga");
    const admin = createAdminClient() as Admin;
    const furgoneta = await leerFurgonetaDe(admin, session.company_id, session.user_id);
    if (!furgoneta) return { ok: false, error: "No tienes furgoneta asignada" };
    const { data } = await admin
      .from("loading_requests")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("company_id", session.company_id)
      .eq("destination_warehouse_id", furgoneta.id)
      .eq("status", "requested")
      .like("notes", `${NOTA_SUGERENCIA}%`)
      .select("id");
    if (((data ?? []) as unknown[]).length === 0) {
      return { ok: false, error: "Esta carga ya no se puede anular (el almacén la está preparando o ya se entregó)." };
    }
    revalidatePath("/mi-furgoneta");
    revalidatePath("/almacenes");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const preferenciaSchema = z.object({
  momento: z.enum(["tarde", "manana"]),
  sugerencia_auto: z.boolean(),
});

/** Preferencia del propio técnico: cuándo carga y si quiere la sugerencia sola. */
export async function guardarMiPreferenciaCarga(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const p = parseOrFriendly(preferenciaSchema, input, "Preferencia de carga");
    const admin = createAdminClient() as Admin;
    const { error } = await admin.from("preferencias_carga_tecnico").upsert(
      {
        company_id: session.company_id,
        user_id: session.user_id,
        momento: p.momento,
        // La automática es solo para quien carga por la tarde.
        sugerencia_auto: p.momento === "tarde" ? p.sugerencia_auto : false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id,user_id" },
    );
    if (error) throw new Error(error.message);
    revalidatePath("/mi-furgoneta");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// =================== Mi reserva (la elige el técnico) ===================

export interface ArticuloReserva {
  tipo: "producto" | "filtro";
  id: string;
  nombre: string;
  referencia: string | null;
  /** Lo que lleva ahora la furgoneta. */
  lleva: number;
}

export interface MiReserva {
  disponible: boolean;
  /** false = aún no tiene reserva propia: las líneas son la plantilla de la empresa. */
  propia: boolean;
  lineas: Array<ArticuloReserva & { cantidad: number }>;
  catalogo: ArticuloReserva[];
}

/**
 * Reserva de MI furgoneta para editarla (Mario 2026-11-25: la reserva la
 * eligen los técnicos). Si aún no tiene, arranca con la de la empresa.
 */
export async function leerMiReserva(): Promise<{ ok: true; datos: MiReserva } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const companyId = session.company_id;
    const admin = createAdminClient() as Admin;
    const furgoneta = await leerFurgonetaDe(admin, companyId, session.user_id);
    if (!furgoneta) return { ok: false, error: "No tienes furgoneta asignada; habla con la oficina." };

    const { filtrosEnAlmacen, esTablaQueFalta } = await import("./filtros-carga");
    const [rs, pr, fi, ws, fs] = await Promise.all([
      admin
        .from("reservas_furgoneta")
        .select("warehouse_id, product_id, filter_id, cantidad")
        .eq("company_id", companyId)
        .or(`warehouse_id.is.null,warehouse_id.eq.${furgoneta.id}`)
        .limit(1000),
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
        .from("warehouse_stock")
        .select("product_id, quantity")
        .eq("company_id", companyId)
        .eq("warehouse_id", furgoneta.id)
        .eq("state", "new")
        .gt("quantity", 0)
        .limit(1000),
      filtrosEnAlmacen(admin, companyId, furgoneta.id),
    ]);
    if (rs.error && esTablaQueFalta(rs.error)) {
      return { ok: true, datos: { disponible: false, propia: false, lineas: [], catalogo: [] } };
    }
    if (rs.error) throw new Error(rs.error.message);

    const llevaP = new Map<string, number>();
    for (const r of (ws.data ?? []) as Array<{ product_id: string; quantity: number }>) {
      llevaP.set(r.product_id, (llevaP.get(r.product_id) ?? 0) + r.quantity);
    }
    const catalogo: ArticuloReserva[] = [
      ...((fi.data ?? []) as Array<{ id: string; name: string; internal_reference: string | null }>).map((f) => ({
        tipo: "filtro" as const,
        id: f.id,
        nombre: f.name,
        referencia: f.internal_reference,
        lleva: fs.get(f.id) ?? 0,
      })),
      ...((pr.data ?? []) as Array<{ id: string; name: string; internal_reference: string | null }>).map((p) => ({
        tipo: "producto" as const,
        id: p.id,
        nombre: p.name,
        referencia: p.internal_reference,
        lleva: llevaP.get(p.id) ?? 0,
      })),
    ];
    const porClave = new Map(catalogo.map((a) => [`${a.tipo}:${a.id}`, a]));
    const filas = (rs.data ?? []) as Array<{
      warehouse_id: string | null;
      product_id: string | null;
      filter_id: string | null;
      cantidad: number;
    }>;
    const propias = filas.filter((f) => f.warehouse_id);
    const base = propias.length > 0 ? propias : filas.filter((f) => !f.warehouse_id);
    const lineas = base
      .filter((f) => f.cantidad > 0)
      .map((f) => {
        const a = porClave.get(f.product_id ? `producto:${f.product_id}` : `filtro:${f.filter_id}`);
        return a ? { ...a, cantidad: f.cantidad } : null;
      })
      .filter((x): x is ArticuloReserva & { cantidad: number } => !!x)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return { ok: true, datos: { disponible: true, propia: propias.length > 0, lineas, catalogo } };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const miReservaSchema = z.object({
  lineas: z
    .array(
      z.object({
        tipo: z.enum(["producto", "filtro"]),
        id: z.string().uuid(),
        cantidad: z.number().int().min(0).max(500),
      }),
    )
    .max(200),
});

/**
 * Guarda la reserva de MI furgoneta: deja exactamente estas líneas.
 * [decide] Si la deja vacía, vuelve a valer la plantilla de la empresa.
 */
export async function guardarMiReserva(input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const companyId = session.company_id;
    const parsed = parseOrFriendly(miReservaSchema, input, "Mi reserva");
    const lineas = lineasConfirmadas(parsed.lineas);
    const admin = createAdminClient() as Admin;
    const furgoneta = await leerFurgonetaDe(admin, companyId, session.user_id);
    if (!furgoneta) return { ok: false, error: "No tienes furgoneta asignada; habla con la oficina." };

    // Los artículos deben ser de la empresa (el admin salta RLS).
    const pIds = lineas.filter((l) => l.tipo === "producto").map((l) => l.id);
    const fIds = lineas.filter((l) => l.tipo === "filtro").map((l) => l.id);
    const [pr, fr] = await Promise.all([
      pIds.length
        ? admin.from("products").select("id").eq("company_id", companyId).is("deleted_at", null).in("id", pIds)
        : { data: [] },
      fIds.length
        ? admin.from("product_filters").select("id").eq("company_id", companyId).is("deleted_at", null).in("id", fIds)
        : { data: [] },
    ]);
    if (
      ((pr.data ?? []) as unknown[]).length !== pIds.length ||
      ((fr.data ?? []) as unknown[]).length !== fIds.length
    ) {
      return { ok: false, error: "Hay un artículo que no es de tu empresa" };
    }

    const { data: actuales, error: errSel } = await admin
      .from("reservas_furgoneta")
      .select("id, product_id, filter_id, cantidad")
      .eq("company_id", companyId)
      .eq("warehouse_id", furgoneta.id);
    if (errSel) throw new Error(errSel.message);
    const filas = (actuales ?? []) as Array<{
      id: string;
      product_id: string | null;
      filter_id: string | null;
      cantidad: number;
    }>;
    const claveFila = (f: (typeof filas)[number]) => (f.product_id ? `producto:${f.product_id}` : `filtro:${f.filter_id}`);
    const existentes = new Map(filas.map((f) => [claveFila(f), f]));
    const deseadas = new Set(lineas.map((l) => `${l.tipo}:${l.id}`));
    const nowIso = new Date().toISOString();

    // Primero altas y cambios, luego bajas: si algo falla a medias, no se
    // queda sin reserva.
    for (const l of lineas) {
      const ex = existentes.get(`${l.tipo}:${l.id}`);
      if (ex) {
        if (ex.cantidad !== l.cantidad) {
          const { error } = await admin
            .from("reservas_furgoneta")
            .update({ cantidad: l.cantidad, updated_by: session.user_id, updated_at: nowIso })
            .eq("id", ex.id)
            .eq("company_id", companyId);
          if (error) throw new Error(error.message);
        }
      } else {
        const { error } = await admin.from("reservas_furgoneta").insert({
          company_id: companyId,
          warehouse_id: furgoneta.id,
          product_id: l.tipo === "producto" ? l.id : null,
          filter_id: l.tipo === "filtro" ? l.id : null,
          cantidad: l.cantidad,
          updated_by: session.user_id,
        });
        if (error) throw new Error(error.message);
      }
    }
    const sobran = filas.filter((f) => !deseadas.has(claveFila(f))).map((f) => f.id);
    if (sobran.length > 0) {
      const { error } = await admin
        .from("reservas_furgoneta")
        .delete()
        .eq("company_id", companyId)
        .eq("warehouse_id", furgoneta.id)
        .in("id", sobran);
      if (error) throw new Error(error.message);
    }
    revalidatePath("/mi-furgoneta");
    revalidatePath("/almacenes/reserva");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
