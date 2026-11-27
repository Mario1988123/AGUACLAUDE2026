"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { captacionActiva, esAdminCaptacion } from "./guard";
import { admin, obtenerToken } from "./servidor";
import { crearPlantilla, ErrorMeta, subirEjemploPlantilla } from "./meta";
import { traducirEstadoPlantilla } from "./logica";
import {
  analizarPlantilla,
  cuerpoCreacionPlantilla,
  cuerpoCreacionPlantillaDocumento,
  plantillaSirveParaCaptacion,
  plantillaSirveParaDocumento,
  validarPlantillaDocumento,
  validarPlantillaNueva,
} from "./envios-logica";
import { pdfEjemploPlantilla } from "./pdf-propuesta";

/**
 * Plantillas de captación desde el panel (fase 3): crearlas en Meta y
 * decir cuál es la de primer contacto y cuál la de recordatorio. Solo el
 * administrador de la empresa (crear una plantilla compromete el número).
 */

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

const RUTA = "/configuracion/captacion";

async function sesionAdmin() {
  const s = await requireSession();
  if (!s.company_id) throw new Error("Sin empresa.");
  if (!esAdminCaptacion(s)) throw new Error("Solo el administrador de la empresa puede tocar las plantillas.");
  if (!(await captacionActiva(s.company_id))) throw new Error("El módulo de captación no está activo en esta empresa.");
  return s as typeof s & { company_id: string };
}

const crearSchema = z.object({
  nombre: z.string().trim().min(1).max(60),
  cuerpo: z.string().max(2000),
  pie: z.string().max(200).nullable(),
  ejemplo: z.string().trim().min(1).max(60),
});

/**
 * Manda la plantilla a Meta (POST /{waba_id}/message_templates) y la guarda
 * en `pendiente`. Meta la revisa y avisa por el webhook; el uso se asigna
 * cuando esté aprobada.
 */
export async function crearPlantillaMetaAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionAdmin();
    const p = crearSchema.parse(input);
    const nueva = { nombre: p.nombre, cuerpo: p.cuerpo, pie: p.pie?.trim() || null, ejemplo: p.ejemplo };
    const v = validarPlantillaNueva(nueva);
    if (!v.ok) return { ok: false, error: v.error };

    const db = admin();
    const { data: con } = await db
      .from("captacion_conexiones")
      .select("estado, waba_id")
      .eq("company_id", s.company_id)
      .maybeSingle();
    const c = con as { estado: string; waba_id: string | null } | null;
    if (c?.estado !== "activa" || !c.waba_id) return { ok: false, error: "Conecta primero el número de WhatsApp." };

    const { data: ya } = await db
      .from("captacion_plantillas")
      .select("id")
      .eq("company_id", s.company_id)
      .eq("nombre", nueva.nombre)
      .eq("idioma", "es")
      .maybeSingle();
    if (ya) return { ok: false, error: "Ya hay una plantilla con ese nombre en español. Cambia el nombre (p. ej. _v2)." };

    const token = await obtenerToken(s.company_id);
    if (!token) return { ok: false, error: "Falta el acceso a Meta: vuelve a conectar el número." };

    const cuerpo = cuerpoCreacionPlantilla(nueva);
    let creada: { id: string; status: string | null; category: string | null };
    try {
      creada = await crearPlantilla(token, c.waba_id, cuerpo);
    } catch (e) {
      if (e instanceof ErrorMeta) return { ok: false, error: `Meta: ${e.message}` };
      throw e;
    }

    const categoriaMeta = (creada.category ?? "MARKETING").toUpperCase();
    const { error } = await db.from("captacion_plantillas").upsert(
      {
        company_id: s.company_id,
        nombre: nueva.nombre,
        idioma: "es",
        categoria: categoriaMeta === "UTILITY" ? "utility" : categoriaMeta === "AUTHENTICATION" ? "authentication" : "marketing",
        estado: traducirEstadoPlantilla(creada.status ?? "PENDING"),
        estado_meta: creada.status ?? "PENDING",
        motivo_rechazo: null,
        componentes: cuerpo.components,
        meta_template_id: creada.id,
        sincronizada_at: new Date().toISOString(),
      },
      { onConflict: "company_id,nombre,idioma" },
    );
    // Ya está creada en Meta: si no se puede guardar, la sincronización la traerá.
    if (error) return { ok: true, aviso: `Creada en Meta, pero no se pudo guardar aquí: pulsa «Traer plantillas de Meta». (${error.message})` };
    revalidatePath(RUTA);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const crearDocumentoSchema = crearSchema.extend({
  categoria: z.enum(["utility", "marketing"]),
});

/**
 * Fase 8: plantilla con cabecera DOCUMENT para mandar la propuesta cuando la
 * ventana de 24 h ya se ha cerrado. Sube a Meta un PDF de ejemplo (sin datos
 * de ningún negocio real) con la Resumable Upload API para el header_handle
 * y crea la plantilla. Solo el admin; nada sale a ningún contacto.
 */
export async function crearPlantillaDocumentoAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionAdmin();
    const p = crearDocumentoSchema.parse(input);
    const nueva = { nombre: p.nombre, cuerpo: p.cuerpo, pie: p.pie?.trim() || null, ejemplo: p.ejemplo, categoria: p.categoria };
    const v = validarPlantillaDocumento(nueva);
    if (!v.ok) return { ok: false, error: v.error };

    const db = admin();
    const [{ data: con }, { data: co }] = await Promise.all([
      db.from("captacion_conexiones").select("estado, waba_id").eq("company_id", s.company_id).maybeSingle(),
      db.from("companies").select("name").eq("id", s.company_id).maybeSingle(),
    ]);
    const c = con as { estado: string; waba_id: string | null } | null;
    if (c?.estado !== "activa" || !c.waba_id) return { ok: false, error: "Conecta primero el número de WhatsApp." };

    const { data: ya } = await db
      .from("captacion_plantillas")
      .select("id")
      .eq("company_id", s.company_id)
      .eq("nombre", nueva.nombre)
      .eq("idioma", "es")
      .maybeSingle();
    if (ya) return { ok: false, error: "Ya hay una plantilla con ese nombre en español. Cambia el nombre (p. ej. _v2)." };

    const token = await obtenerToken(s.company_id);
    if (!token) return { ok: false, error: "Falta el acceso a Meta: vuelve a conectar el número." };

    const empresa = (co as { name: string } | null)?.name ?? "Propuesta";
    let cuerpo: ReturnType<typeof cuerpoCreacionPlantillaDocumento>;
    let creada: { id: string; status: string | null; category: string | null };
    try {
      const bytes = await pdfEjemploPlantilla(empresa, nueva.ejemplo);
      const handle = await subirEjemploPlantilla(token, { bytes, nombre: "propuesta-ejemplo.pdf", tipo: "application/pdf" });
      cuerpo = cuerpoCreacionPlantillaDocumento(nueva, handle);
      creada = await crearPlantilla(token, c.waba_id, cuerpo);
    } catch (e) {
      if (e instanceof ErrorMeta) return { ok: false, error: `Meta: ${e.message}` };
      throw e;
    }

    const categoriaMeta = (creada.category ?? cuerpo.category).toUpperCase();
    const { error } = await db.from("captacion_plantillas").upsert(
      {
        company_id: s.company_id,
        nombre: nueva.nombre,
        idioma: "es",
        categoria: categoriaMeta === "UTILITY" ? "utility" : categoriaMeta === "AUTHENTICATION" ? "authentication" : "marketing",
        estado: traducirEstadoPlantilla(creada.status ?? "PENDING"),
        estado_meta: creada.status ?? "PENDING",
        motivo_rechazo: null,
        componentes: cuerpo.components,
        meta_template_id: creada.id,
        sincronizada_at: new Date().toISOString(),
      },
      { onConflict: "company_id,nombre,idioma" },
    );
    if (error) return { ok: true, aviso: `Creada en Meta, pero no se pudo guardar aquí: pulsa «Traer plantillas de Meta». (${error.message})` };
    revalidatePath(RUTA);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

const usoSchema = z.object({
  plantillaId: z.string().uuid(),
  uso: z.enum(["primer_contacto", "recordatorio", "documento"]).nullable(),
});

/**
 * Dice para qué se usa una plantilla aprobada. Solo una por uso y empresa:
 * al asignarla, la que lo tuviera lo pierde.
 */
export async function asignarUsoPlantillaAction(input: unknown): Promise<Resultado> {
  try {
    const s = await sesionAdmin();
    const p = usoSchema.parse(input);
    const db = admin();
    const { data } = await db
      .from("captacion_plantillas")
      .select("id, estado, componentes")
      .eq("company_id", s.company_id)
      .eq("id", p.plantillaId)
      .maybeSingle();
    const pl = data as { id: string; estado: string; componentes: unknown } | null;
    if (!pl) return { ok: false, error: "Plantilla no encontrada." };

    if (p.uso) {
      if (pl.estado !== "aprobada") return { ok: false, error: "Solo se puede usar una plantilla aprobada por Meta." };
      const analisis = analizarPlantilla(pl.componentes);
      if (p.uso === "documento") {
        const sirve = plantillaSirveParaDocumento(analisis);
        if (!sirve.ok) return { ok: false, error: `No sirve para mandar la propuesta: ${sirve.motivo}` };
      } else {
        const sirve = plantillaSirveParaCaptacion(analisis);
        if (!sirve.ok) return { ok: false, error: `No sirve para captación: ${sirve.motivo}` };
      }
      const { error: e1 } = await db
        .from("captacion_plantillas")
        .update({ uso: null })
        .eq("company_id", s.company_id)
        .eq("uso", p.uso)
        .neq("id", pl.id);
      if (e1) throw new Error(e1.message);
    }
    const { error } = await db
      .from("captacion_plantillas")
      .update({ uso: p.uso })
      .eq("company_id", s.company_id)
      .eq("id", pl.id);
    if (error) throw new Error(error.message);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
