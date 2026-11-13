"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { esNivel12 } from "@/shared/lib/auth/role-scope";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { safeParseFriendly } from "@/shared/lib/zod-friendly";
import { mantIncluidoDisponible, precioModeloDisponible } from "./datos";
import { N_MAXIMO } from "./logica";

/**
 * Acciones de «mantenimientos incluidos». Todas con admin + company_id a mano
 * (regla R7 del plan) y solo para nivel 1/2 (admin, dir. técnico, dir.
 * comercial: los mismos que editan la modalidad del equipo).
 */

type Res = { ok: true } | { ok: false; error: string };
const SIN_MIGRACION = "Falta aplicar la migración de mantenimientos incluidos";

const zCents = z.number().int().min(0, "El precio no puede ser negativo").max(10_000_000).nullable();

// ---------------------------------------------------------------------------
// Equipo (+ precio del cliente)
// ---------------------------------------------------------------------------

const equipoSchema = z.object({
  equipment_id: z.string().uuid(),
  n: z.number().int().min(0, "Mínimo 0").max(N_MAXIMO, `Máximo ${N_MAXIMO}`).nullable(),
  origen: z.enum(["venta", "renting", "manual", "importacion"]).nullable().optional(),
  precio_filtros_cents: zCents,
  precio_membrana_cents: zCents,
  /** Si viene, se guarda también el precio propio del CLIENTE. */
  cliente: z
    .object({
      precio_filtros_cents: zCents,
      precio_membrana_cents: zCents,
    })
    .nullable()
    .optional(),
});

export async function guardarMantEquipoAction(input: unknown): Promise<Res> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!esNivel12(session)) return { ok: false, error: "Sin permisos" };
    if (!(await mantIncluidoDisponible())) return { ok: false, error: SIN_MIGRACION };
    const [pd, perr] = safeParseFriendly(equipoSchema, input);
    if (perr !== null || !pd) return { ok: false, error: perr ?? "Datos no válidos" };
    const p = { data: pd };
    const d = p.data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: eq } = await admin
      .from("customer_equipment")
      .select("id, customer_id")
      .eq("id", d.equipment_id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    const row = eq as { id: string; customer_id: string } | null;
    if (!row) return { ok: false, error: "Equipo no encontrado o no pertenece a tu empresa" };

    const r = await admin
      .from("customer_equipment")
      .update({
        mant_incluidos_n: d.n,
        mant_incluido_origen: d.n == null ? null : (d.origen ?? "manual"),
        mant_precio_filtros_cents: d.precio_filtros_cents,
        mant_precio_filtros_membrana_cents: d.precio_membrana_cents,
        mant_incluido_actualizado_por: session.user_id,
        mant_incluido_actualizado_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("company_id", session.company_id);
    if (r.error) return { ok: false, error: r.error.message };

    if (d.cliente) {
      const rc = await admin
        .from("customers")
        .update({
          mant_precio_filtros_cents: d.cliente.precio_filtros_cents,
          mant_precio_filtros_membrana_cents: d.cliente.precio_membrana_cents,
        })
        .eq("id", row.customer_id)
        .eq("company_id", session.company_id);
      if (rc.error) return { ok: false, error: rc.error.message };
    }

    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "customer",
      subject_id: row.customer_id,
      kind: "equipment.mant_incluido_updated",
      payload: {
        equipment_id: row.id,
        n: d.n,
        precio_filtros_cents: d.precio_filtros_cents,
        precio_membrana_cents: d.precio_membrana_cents,
        cliente: d.cliente ?? null,
      },
      actor_user_id: session.user_id,
    });

    revalidatePath(`/clientes/${row.customer_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// ---------------------------------------------------------------------------
// Configuración de la empresa
// ---------------------------------------------------------------------------

const configSchema = z.object({
  n_defecto: z.number().int().min(0).max(N_MAXIMO).nullable(),
  precio_filtros_cents: zCents,
  precio_membrana_cents: zCents,
});

export async function guardarConfigMantAction(input: unknown): Promise<Res> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!session.is_superadmin && !session.roles.includes("company_admin")) {
      return { ok: false, error: "Solo admin" };
    }
    if (!(await mantIncluidoDisponible())) return { ok: false, error: SIN_MIGRACION };
    const [pd, perr] = safeParseFriendly(configSchema, input);
    if (perr !== null || !pd) return { ok: false, error: perr ?? "Datos no válidos" };
    const p = { data: pd };
    const cambios = {
      mant_incluidos_n_defecto: p.data.n_defecto,
      mant_precio_filtros_cents: p.data.precio_filtros_cents,
      mant_precio_filtros_membrana_cents: p.data.precio_membrana_cents,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: existe } = await admin
      .from("company_settings")
      .select("company_id")
      .eq("company_id", session.company_id)
      .maybeSingle();
    const r = existe
      ? await admin.from("company_settings").update(cambios).eq("company_id", session.company_id)
      : await admin.from("company_settings").insert({ company_id: session.company_id, ...cambios });
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/configuracion/mantenimientos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// ---------------------------------------------------------------------------
// Precio del mantenimiento por modelo (gama o variante)
// ---------------------------------------------------------------------------

const precioModeloSchema = z.object({
  product_id: z.string().uuid(),
  precio_filtros_cents: zCents,
  precio_membrana_cents: zCents,
});

export async function guardarPrecioModeloAction(input: unknown): Promise<Res> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!esNivel12(session)) return { ok: false, error: "Sin permisos" };
    if (!(await precioModeloDisponible())) {
      return { ok: false, error: "Falta aplicar la migración del precio por modelo" };
    }
    const [pd, perr] = safeParseFriendly(precioModeloSchema, input);
    if (perr !== null || !pd) return { ok: false, error: perr ?? "Datos no válidos" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const upd = await admin
      .from("products")
      .update({
        mant_precio_filtros_cents: pd.precio_filtros_cents,
        mant_precio_filtros_membrana_cents: pd.precio_membrana_cents,
      })
      .eq("id", pd.product_id)
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .select("id, name");
    if (upd.error) return { ok: false, error: upd.error.message };
    const fila = ((upd.data ?? []) as Array<{ id: string; name: string }>)[0];
    if (!fila) return { ok: false, error: "Modelo no encontrado o no pertenece a tu empresa" };
    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "product",
      subject_id: fila.id,
      kind: "product.mant_precio_updated",
      payload: {
        precio_filtros_cents: pd.precio_filtros_cents,
        precio_membrana_cents: pd.precio_membrana_cents,
      },
      actor_user_id: session.user_id,
    });
    revalidatePath("/configuracion/mantenimientos");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

// ---------------------------------------------------------------------------
// Visita: «Marcar como pagado» (oficina)
// ---------------------------------------------------------------------------

const pagadoSchema = z.object({
  job_id: z.string().uuid(),
  tarifa: z.enum(["solo_filtros", "filtros_membrana"]).nullable(),
  /** Base SIN IVA cobrada (opcional). */
  cents: zCents,
  metodo: z.enum(["cash", "card", "bizum", "transfer", "direct_debit", "financing"]).nullable(),
});

export async function marcarVisitaPagadaAction(input: unknown): Promise<Res> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!esNivel12(session)) return { ok: false, error: "Solo la oficina puede marcarlo como pagado" };
    if (!(await mantIncluidoDisponible())) return { ok: false, error: SIN_MIGRACION };
    const [pd, perr] = safeParseFriendly(pagadoSchema, input);
    if (perr !== null || !pd) return { ok: false, error: perr ?? "Datos no válidos" };
    const p = { data: pd };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const upd = await admin
      .from("maintenance_jobs")
      .update({
        pago_estado: "pagado_oficina",
        pagado_marcado_por: session.user_id,
        pagado_marcado_at: new Date().toISOString(),
        pagado_oficina_tarifa: p.data.tarifa,
        pagado_oficina_cents: p.data.cents,
        pagado_oficina_metodo: p.data.metodo,
        importe_pendiente_cents: null,
        is_charged: true,
      })
      .eq("id", p.data.job_id)
      .eq("company_id", session.company_id)
      .in("pago_estado", ["incluido", "pendiente", "no_cobrado"])
      .select("id, customer_id");
    if (upd.error) return { ok: false, error: upd.error.message };
    const fila = ((upd.data ?? []) as Array<{ id: string; customer_id: string }>)[0];
    if (!fila) return { ok: false, error: "Esta visita ya consta como cobrada o pagada" };
    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "maintenance",
      subject_id: fila.id,
      kind: "maintenance.pagado_oficina",
      payload: { tarifa: p.data.tarifa, cents: p.data.cents, metodo: p.data.metodo },
      actor_user_id: session.user_id,
    });
    revalidatePath(`/mantenimientos/${fila.id}`);
    revalidatePath("/mantenimientos");
    revalidatePath(`/clientes/${fila.customer_id}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/** Quita la marca «Pagado en oficina» (error de la oficina). Solo si la visita no está cerrada. */
export async function quitarPagadoVisitaAction(jobId: string): Promise<Res> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!esNivel12(session)) return { ok: false, error: "Sin permisos" };
    if (!(await mantIncluidoDisponible())) return { ok: false, error: SIN_MIGRACION };
    if (!z.string().uuid().safeParse(jobId).success) return { ok: false, error: "Visita no válida" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const upd = await admin
      .from("maintenance_jobs")
      .update({
        pago_estado: "incluido", // la app vuelve a derivar «pendiente» de k > N
        pagado_marcado_por: null,
        pagado_marcado_at: null,
        pagado_oficina_tarifa: null,
        pagado_oficina_cents: null,
        pagado_oficina_metodo: null,
      })
      .eq("id", jobId)
      .eq("company_id", session.company_id)
      .eq("pago_estado", "pagado_oficina")
      .not("status", "in", "(completed,cancelled)")
      .select("id");
    if (upd.error) return { ok: false, error: upd.error.message };
    if (!upd.data || (upd.data as unknown[]).length === 0) {
      return { ok: false, error: "Solo se puede quitar en visitas abiertas marcadas como pagadas" };
    }
    revalidatePath(`/mantenimientos/${jobId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
