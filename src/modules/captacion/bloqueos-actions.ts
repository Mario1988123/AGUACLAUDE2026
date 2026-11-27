"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, type SessionClaims } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { createClient as crearClienteSesion } from "@/shared/lib/supabase/server";
import { captacionActiva } from "./guard";
import { admin } from "./servidor";
import { normalizarTelefonoES } from "./busqueda-logica";
import { cancelarEnviosPendientes } from "./envios-servidor";

/**
 * Lista de bloqueo de captación («nunca más», plan §3.3 y §2.2).
 *  · Ver y añadir: gestores y comerciales.
 *  · Quitar: solo company_admin (y superadmin).
 * Lectura con el cliente de la sesión (RLS); escritura con el de servicio,
 * filtrando por la empresa de la sesión, después de comprobar el rol aquí.
 */

const ROLES_BLOQUEOS = ["company_admin", "commercial_director", "telemarketing_director", "sales_rep", "telemarketer"];
const RUTA = "/captacion/bloqueos";

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

export interface BloqueoFila {
  id: string;
  ambito: "telefono" | "bsuid";
  valor: string;
  motivo: "boton_no" | "baja_texto" | "queja" | "manual" | "cliente";
  negocio: string | null;
  created_at: string;
}

function puedeBloqueos(s: SessionClaims): boolean {
  return s.is_superadmin || s.roles.some((r) => ROLES_BLOQUEOS.includes(r));
}

function puedeQuitarBloqueo(s: SessionClaims): boolean {
  return s.is_superadmin || s.roles.includes("company_admin");
}

async function sesionBloqueos() {
  const s = await requireSession();
  if (!s.company_id) throw new Error("Sin empresa.");
  if (!puedeBloqueos(s)) throw new Error("No tienes acceso a la lista de bloqueo.");
  if (!(await captacionActiva(s.company_id))) throw new Error("El módulo de captación no está activo.");
  return s as SessionClaims & { company_id: string };
}

export async function listarBloqueos(busqueda: string): Promise<{
  bloqueos: BloqueoFila[];
  puedeQuitar: boolean;
} | null> {
  const s = await requireSession();
  if (!s.company_id || !puedeBloqueos(s) || !(await captacionActiva(s.company_id))) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await crearClienteSesion()) as any;
  let q = db
    .from("captacion_bloqueos")
    .select("id, ambito, valor, motivo, created_at, captacion_prospectos(nombre_negocio)")
    .eq("company_id", s.company_id)
    .order("created_at", { ascending: false })
    .limit(200);
  const digitos = busqueda.replace(/\D/g, "");
  if (digitos.length >= 3) q = q.ilike("valor", `%${digitos}%`);
  const { data, error } = await q;
  if (error) throw new Error(`No se pudo leer la lista de bloqueo: ${error.message}`);
  return {
    puedeQuitar: puedeQuitarBloqueo(s),
    bloqueos: ((data ?? []) as Array<Omit<BloqueoFila, "negocio"> & { captacion_prospectos: { nombre_negocio: string } | null }>).map(
      ({ captacion_prospectos, ...b }) => ({ ...b, negocio: captacion_prospectos?.nombre_negocio ?? null }),
    ),
  };
}

const anadirSchema = z.object({
  telefono: z.string().trim().min(6).max(30),
  motivo: z.enum(["manual", "queja", "cliente"]).default("manual"),
});

/**
 * Añade un teléfono. Si es de un prospecto, se cancelan sus envíos
 * pendientes y, si aún no se le había escrito, se descarta.
 */
export async function anadirBloqueoAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionBloqueos();
    const p = anadirSchema.parse(input);
    const telefono = normalizarTelefonoES(p.telefono);
    if (!telefono) return { ok: false, error: "Ese teléfono no parece español. Escríbelo con 9 cifras o con +34." };
    const db = admin();

    const { data: pr } = await db
      .from("captacion_prospectos")
      .select("id, etapa")
      .eq("company_id", s.company_id)
      .eq("telefono_e164", telefono)
      .maybeSingle();
    const prospecto = pr as { id: string; etapa: string } | null;

    const { data, error } = await db
      .from("captacion_bloqueos")
      .upsert(
        {
          company_id: s.company_id,
          ambito: "telefono",
          valor: telefono,
          motivo: p.motivo,
          prospecto_id: prospecto?.id ?? null,
          created_by: s.user_id,
        },
        { onConflict: "company_id,ambito,valor", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(error.message);
    const nuevo = ((data ?? []) as unknown[]).length > 0;

    if (prospecto) {
      await cancelarEnviosPendientes(s.company_id, prospecto.id, "Bloqueado a mano");
      await db
        .from("captacion_prospectos")
        .update({ etapa: "descartado", descartado_motivo: "Bloqueado a mano" })
        .eq("company_id", s.company_id)
        .eq("id", prospecto.id)
        .in("etapa", ["nuevo", "revisar", "en_cola"]);
    }
    revalidatePath(RUTA);
    return nuevo ? { ok: true } : { ok: true, aviso: "Ese teléfono ya estaba en la lista." };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/** Quitar de la lista: solo el administrador de la empresa (§2.2). */
export async function quitarBloqueoAction(id: string): Promise<Resultado> {
  try {
    const s = await sesionBloqueos();
    if (!puedeQuitarBloqueo(s)) return { ok: false, error: "Solo el administrador de la empresa puede quitar un bloqueo." };
    z.string().uuid().parse(id);
    const { data, error } = await admin()
      .from("captacion_bloqueos")
      .delete()
      .eq("company_id", s.company_id)
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    if (((data ?? []) as unknown[]).length === 0) return { ok: false, error: "No encontrado." };
    revalidatePath(RUTA);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
