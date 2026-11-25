"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { encryptSecret } from "@/modules/mailing/encryption";
import { captacionActiva, esAdminCaptacion, puedeLeerConfig } from "./guard";
import { admin, obtenerToken, sincronizarPlantillas } from "./servidor";
import {
  desregistrarNumero,
  ErrorMeta,
  intercambiarCodigo,
  leerNumero,
  listarNumerosWaba,
  registrarNumero,
  suscribirAppAWaba,
} from "./meta";
import { aE164, generarPin, traducirCalidad, traducirLimite } from "./logica";
import type { EstadoCaptacion } from "./tipos";

type Resultado = { ok: true; aviso?: string } | { ok: false; error: string };

const RUTA = "/configuracion/captacion";

async function sesionAdmin() {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa.");
  if (!esAdminCaptacion(session)) {
    throw new Error("Solo el administrador de la empresa puede tocar esta configuración.");
  }
  if (!(await captacionActiva(session.company_id))) {
    throw new Error("El módulo de captación no está activo en esta empresa.");
  }
  return session as typeof session & { company_id: string };
}

function textoErrorMeta(e: unknown): string {
  if (e instanceof ErrorMeta) return `Meta: ${e.message}`;
  return toActionError(e);
}

// -----------------------------------------------------------------------------
// Lectura
// -----------------------------------------------------------------------------

export async function obtenerEstadoCaptacion(): Promise<EstadoCaptacion | null> {
  const session = await requireSession();
  if (!session.company_id || !puedeLeerConfig(session)) return null;
  if (!(await captacionActiva(session.company_id))) return null;

  const db = admin();
  const [{ data: con }, { data: plantillas }] = await Promise.all([
    db
      .from("captacion_conexiones")
      .select(
        "estado, waba_id, phone_number_id, numero_e164, nombre_visible, calidad, limite_diario_meta, margen_seguridad, negocio_verificado, envios_activos, tope_gasto_mensual_cents, retencion_dias, presentacion_empresa, temas_prohibidos, conectada_at, ultimo_webhook_at, ultimo_error",
      )
      .eq("company_id", session.company_id)
      .maybeSingle(),
    db
      .from("captacion_plantillas")
      .select("id, nombre, idioma, categoria, estado, estado_meta, motivo_rechazo, uso, sincronizada_at")
      .eq("company_id", session.company_id)
      .order("nombre"),
  ]);

  return {
    esAdmin: esAdminCaptacion(session),
    meta: {
      appId: process.env.META_APP_ID ?? null,
      configId: process.env.META_CONFIG_ID ?? null,
      graphVersion: process.env.META_GRAPH_VERSION || "v27.0",
      webhookFirmado: Boolean(process.env.META_APP_SECRET),
    },
    enviosPlataforma: process.env.CAPTACION_ENVIOS_ACTIVOS === "1",
    conexion: (con as EstadoCaptacion["conexion"]) ?? null,
    plantillas: (plantillas ?? []) as EstadoCaptacion["plantillas"],
  };
}

// -----------------------------------------------------------------------------
// Conectar (Embedded Signup v4)
// -----------------------------------------------------------------------------

const conectarSchema = z.object({
  code: z.string().trim().min(10).max(4000),
  waba_id: z.string().regex(/^\d{5,30}$/, "waba_id no válido"),
  phone_number_id: z.string().regex(/^\d{5,30}$/, "phone_number_id no válido"),
  business_id: z.string().regex(/^\d{5,30}$/).nullable().optional(),
});

/**
 * Paso de servidor del Embedded Signup (plan §4.1). No se fía de los ids que
 * manda el navegador: los comprueba con el token recién obtenido.
 */
export async function conectarWhatsappAction(input: unknown): Promise<Resultado> {
  let companyId: string | null = null;
  try {
    const session = await sesionAdmin();
    companyId = session.company_id;
    const p = conectarSchema.parse(input);
    const db = admin();

    // 1) ¿Ese número ya está en otra empresa? (el índice único lo frenaría
    //    igual; así el mensaje es claro y no se gasta el code).
    const { data: otra } = await db
      .from("captacion_conexiones")
      .select("company_id")
      .or(`phone_number_id.eq.${p.phone_number_id},waba_id.eq.${p.waba_id}`)
      .neq("company_id", companyId)
      .limit(1);
    if ((otra ?? []).length > 0) {
      return { ok: false, error: "Ese número o esa cuenta de WhatsApp ya están conectados a otra empresa." };
    }

    // 2) code → token de negocio (caduca a los 5 minutos).
    const token = await intercambiarCodigo(p.code);

    // 3) El token tiene que ver esa WABA y ese número.
    const numeros = await listarNumerosWaba(token, p.waba_id);
    if (!numeros.some((n) => n.id === p.phone_number_id)) {
      return { ok: false, error: "El número elegido no pertenece a la cuenta de WhatsApp autorizada." };
    }
    const ficha = await leerNumero(token, p.phone_number_id);

    // 4) Fila de conexión (pendiente) y secretos cifrados.
    const pin = generarPin(randomBytes);
    const ahora = new Date().toISOString();
    const { error: eCon } = await db.from("captacion_conexiones").upsert(
      {
        company_id: companyId,
        estado: "pendiente",
        waba_id: p.waba_id,
        business_id: p.business_id ?? null,
        phone_number_id: p.phone_number_id,
        numero_e164: aE164(ficha.display_phone_number),
        nombre_visible: ficha.verified_name ?? null,
        calidad: traducirCalidad(ficha.quality_rating),
        limite_diario_meta: traducirLimite(ficha.whatsapp_business_manager_messaging_limit) ?? 250,
        envios_activos: false,
        ia_activa: false,
        conectada_por: session.user_id,
        ultimo_error: null,
      },
      { onConflict: "company_id" },
    );
    if (eCon) {
      if ((eCon as { code?: string }).code === "23505") {
        return { ok: false, error: "Ese número ya está conectado a otra empresa." };
      }
      throw new Error(eCon.message);
    }
    const { error: eSec } = await db.from("captacion_conexion_secretos").upsert(
      {
        company_id: companyId,
        token_cifrado: encryptSecret(token),
        token_rotado_at: ahora,
        pin_registro_cifrado: encryptSecret(pin),
      },
      { onConflict: "company_id" },
    );
    if (eSec) throw new Error(eSec.message);

    // 5) Webhooks de esa WABA hacia la app de Vercomi. 6) Registro en la Cloud API.
    await suscribirAppAWaba(token, p.waba_id);
    await registrarNumero(token, p.phone_number_id, pin);

    // 7) Activa.
    const { error: eAct } = await db
      .from("captacion_conexiones")
      .update({ estado: "activa", conectada_at: ahora, ultimo_error: null })
      .eq("company_id", companyId);
    if (eAct) throw new Error(eAct.message);

    // 8) Plantillas. Si falla, la conexión ya vale: se avisa y se puede repetir.
    let aviso: string | undefined;
    try {
      await sincronizarPlantillas(companyId);
    } catch (e) {
      aviso = `Conectado, pero no se pudieron traer las plantillas: ${textoErrorMeta(e)}`;
    }

    revalidatePath(RUTA);
    return { ok: true, aviso };
  } catch (e) {
    const error = textoErrorMeta(e);
    if (companyId) {
      await admin()
        .from("captacion_conexiones")
        .update({ ultimo_error: error.slice(0, 500) })
        .eq("company_id", companyId)
        .neq("estado", "activa");
    }
    return { ok: false, error };
  }
}

// -----------------------------------------------------------------------------
// Ajustes
// -----------------------------------------------------------------------------

const ajustesSchema = z.object({
  envios_activos: z.boolean(),
  margen_seguridad: z.number().int().min(0).max(1000),
  tope_gasto_mensual_cents: z.number().int().min(0).max(10_000_000),
  retencion_dias: z.number().int().min(30).max(3650),
  presentacion_empresa: z.string().trim().max(4000).nullable(),
  temas_prohibidos: z.string().trim().max(4000).nullable(),
});

export type AjustesCaptacionInput = z.infer<typeof ajustesSchema>;

export async function guardarAjustesCaptacionAction(input: AjustesCaptacionInput): Promise<Resultado> {
  try {
    const session = await sesionAdmin();
    const p = ajustesSchema.parse(input);
    const db = admin();
    const { data: con } = await db
      .from("captacion_conexiones")
      .select("estado")
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!con) return { ok: false, error: "Conecta primero el número de WhatsApp." };
    if (p.envios_activos && (con as { estado: string }).estado !== "activa") {
      return { ok: false, error: "Los envíos solo se pueden encender con la conexión activa." };
    }
    const { error } = await db
      .from("captacion_conexiones")
      .update(p)
      .eq("company_id", session.company_id);
    if (error) throw new Error(error.message);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function sincronizarPlantillasAction(): Promise<Resultado & { total?: number }> {
  try {
    const session = await sesionAdmin();
    const total = await sincronizarPlantillas(session.company_id);
    revalidatePath(RUTA);
    return { ok: true, total };
  } catch (e) {
    return { ok: false, error: textoErrorMeta(e) };
  }
}

/** Refresca nombre, calidad y límite desde Meta. */
export async function refrescarNumeroAction(): Promise<Resultado> {
  try {
    const session = await sesionAdmin();
    const db = admin();
    const { data: con } = await db
      .from("captacion_conexiones")
      .select("phone_number_id")
      .eq("company_id", session.company_id)
      .maybeSingle();
    const pnid = (con as { phone_number_id: string | null } | null)?.phone_number_id;
    const token = await obtenerToken(session.company_id);
    if (!pnid || !token) return { ok: false, error: "No hay número conectado." };
    const f = await leerNumero(token, pnid);
    const limite = traducirLimite(f.whatsapp_business_manager_messaging_limit);
    const { error } = await db
      .from("captacion_conexiones")
      .update({
        numero_e164: aE164(f.display_phone_number),
        nombre_visible: f.verified_name ?? null,
        calidad: traducirCalidad(f.quality_rating),
        ...(limite != null ? { limite_diario_meta: limite } : {}),
      })
      .eq("company_id", session.company_id);
    if (error) throw new Error(error.message);
    revalidatePath(RUTA);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: textoErrorMeta(e) };
  }
}

// -----------------------------------------------------------------------------
// Desconectar
// -----------------------------------------------------------------------------

export async function desconectarWhatsappAction(): Promise<Resultado> {
  try {
    const session = await sesionAdmin();
    const db = admin();
    const { data: con } = await db
      .from("captacion_conexiones")
      .select("phone_number_id")
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!con) return { ok: false, error: "No hay nada conectado." };

    let aviso: string | undefined;
    const pnid = (con as { phone_number_id: string | null }).phone_number_id;
    try {
      const token = await obtenerToken(session.company_id);
      if (token && pnid) await desregistrarNumero(token, pnid);
    } catch (e) {
      aviso = `Desconectado aquí, pero Meta no confirmó la baja del número (${textoErrorMeta(e)}). Revísalo en el administrador de WhatsApp.`;
    }

    // Primero se apaga todo; después se borra el token.
    const { error } = await db
      .from("captacion_conexiones")
      .update({ estado: "desconectada", envios_activos: false, ia_activa: false })
      .eq("company_id", session.company_id);
    if (error) throw new Error(error.message);
    const { error: eSec } = await db
      .from("captacion_conexion_secretos")
      .delete()
      .eq("company_id", session.company_id);
    if (eSec) throw new Error(eSec.message);

    revalidatePath(RUTA);
    return { ok: true, aviso };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
