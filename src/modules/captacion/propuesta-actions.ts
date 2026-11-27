"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession, type SessionClaims } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { captacionActiva } from "./guard";
import { admin } from "./servidor";
import { MAX_CARTA, MAX_EQUIPOS, MAX_QUE_INCLUYE_LINEAS } from "./propuesta-logica";

/**
 * Mando de la propuesta (fase 4): qué equipos lleva cada campaña, el texto de
 * la carta y «Qué incluye» (por campaña); la URL de privacidad y qué precios
 * se enseñan (por empresa, decisión 2 de Mario: sin precios por defecto).
 */

const GESTORES = ["company_admin", "commercial_director", "telemarketing_director"];

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function esGestor(s: SessionClaims): boolean {
  return s.is_superadmin || s.roles.some((r) => GESTORES.includes(r));
}

async function sesionGestor() {
  const s = await requireSession();
  if (!s.company_id) throw new Error("Sin empresa.");
  if (!esGestor(s)) throw new Error("No tienes permiso para gestionar las campañas de captación.");
  if (!(await captacionActiva(s.company_id))) throw new Error("El módulo de captación no está activo.");
  return s as SessionClaims & { company_id: string };
}

export interface PropuestaCampana {
  equipos: Array<{ id: string; nombre: string }>;
  disponibles: Array<{ id: string; nombre: string }>;
  textoCarta: string | null;
  queIncluye: string | null;
  /** Lo que la empresa enseña de precios (Configuración). */
  conPrecios: boolean;
  enviadas: number;
  abiertas: number;
}

export async function obtenerPropuestaCampana(campanaId: string): Promise<PropuestaCampana | null> {
  const s = await requireSession();
  if (!s.company_id || !esGestor(s) || !(await captacionActiva(s.company_id))) return null;
  if (!z.string().uuid().safeParse(campanaId).success) return null;
  const db = admin();
  const [c, cps, prods, con, enviadas, abiertas] = await Promise.all([
    db.from("captacion_campanas").select("texto_carta, que_incluye").eq("company_id", s.company_id).eq("id", campanaId).maybeSingle(),
    db.from("captacion_campana_productos").select("product_id, orden").eq("company_id", s.company_id).eq("campana_id", campanaId).order("orden"),
    db
      .from("products")
      .select("id, name, kind")
      .eq("company_id", s.company_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name")
      .limit(500),
    db.from("captacion_conexiones").select("propuesta_precios").eq("company_id", s.company_id).maybeSingle(),
    db.from("captacion_propuestas").select("id", { count: "exact", head: true })
      .eq("company_id", s.company_id).eq("campana_id", campanaId).not("enviada_at", "is", null),
    db.from("captacion_propuestas").select("id", { count: "exact", head: true })
      .eq("company_id", s.company_id).eq("campana_id", campanaId).not("primera_visita_at", "is", null),
  ]);
  if (c.error || !c.data) return null;
  const nombres = new Map(((prods.data ?? []) as Array<{ id: string; name: string; kind: string }>).map((p) => [p.id, p.name]));
  const equipos = ((cps.data ?? []) as Array<{ product_id: string }>)
    .filter((x) => nombres.has(x.product_id))
    .map((x) => ({ id: x.product_id, nombre: nombres.get(x.product_id)! }));
  const elegidos = new Set(equipos.map((e) => e.id));
  const disponibles = ((prods.data ?? []) as Array<{ id: string; name: string; kind: string }>)
    .filter((p) => !elegidos.has(p.id))
    .sort((a, b) => Number(b.kind === "equipment") - Number(a.kind === "equipment") || a.name.localeCompare(b.name, "es"))
    .map((p) => ({ id: p.id, nombre: p.name }));
  const fila = c.data as { texto_carta: string | null; que_incluye: string | null };
  return {
    equipos,
    disponibles,
    textoCarta: fila.texto_carta,
    queIncluye: fila.que_incluye,
    conPrecios: (((con.data as { propuesta_precios?: string[] } | null)?.propuesta_precios ?? []) as string[]).length > 0,
    enviadas: (enviadas as { count: number | null }).count ?? 0,
    abiertas: (abiertas as { count: number | null }).count ?? 0,
  };
}

const guardarSchema = z.object({
  campanaId: z.string().uuid(),
  productIds: z.array(z.string().uuid()).max(MAX_EQUIPOS),
  textoCarta: z.string().trim().max(MAX_CARTA).nullable(),
  queIncluye: z
    .string()
    .trim()
    .max(400)
    .nullable()
    .refine((v) => !v || v.split(/\r?\n/).filter((x) => x.trim()).length <= MAX_QUE_INCLUYE_LINEAS, {
      message: `«Qué incluye» admite como mucho ${MAX_QUE_INCLUYE_LINEAS} líneas.`,
    }),
});

export async function guardarPropuestaCampanaAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionGestor();
    const p = guardarSchema.parse(input);
    const ids = [...new Set(p.productIds)];
    const db = admin();

    const { data: camp, error: eC } = await db
      .from("captacion_campanas")
      .select("id")
      .eq("company_id", s.company_id)
      .eq("id", p.campanaId)
      .maybeSingle();
    if (eC) throw new Error(eC.message);
    if (!camp) return { ok: false, error: "No existe la campaña." };

    // Solo productos de la empresa (IDOR).
    if (ids.length > 0) {
      const { data: propios, error } = await db
        .from("products")
        .select("id")
        .eq("company_id", s.company_id)
        .in("id", ids)
        .is("deleted_at", null);
      if (error) throw new Error(error.message);
      if (((propios ?? []) as unknown[]).length !== ids.length) return { ok: false, error: "Algún equipo no es de tu empresa." };
    }

    const { error: eU } = await db
      .from("captacion_campanas")
      .update({ texto_carta: p.textoCarta || null, que_incluye: p.queIncluye || null })
      .eq("company_id", s.company_id)
      .eq("id", p.campanaId);
    if (eU) throw new Error(eU.message);

    const { error: eD } = await db
      .from("captacion_campana_productos")
      .delete()
      .eq("company_id", s.company_id)
      .eq("campana_id", p.campanaId);
    if (eD) throw new Error(eD.message);
    if (ids.length > 0) {
      const { error: eI } = await db.from("captacion_campana_productos").insert(
        ids.map((product_id, orden) => ({ company_id: s.company_id, campana_id: p.campanaId, product_id, orden })),
      );
      if (eI) throw new Error(eI.message);
    }
    revalidatePath(`/captacion/campanas/${p.campanaId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
