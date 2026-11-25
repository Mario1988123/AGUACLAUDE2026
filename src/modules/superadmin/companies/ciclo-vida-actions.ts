"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { esEmpresaProtegida } from "@/shared/lib/empresas/estado";
import { logSuperadminAction } from "@/modules/superadmin/audit-actions";

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function ensureSuperadmin() {
  const session = await requireSession();
  if (!session.is_superadmin) throw new Error("Solo superadmin");
  return session;
}

export type AccionEstadoEmpresa = "pausar" | "dar_baja" | "reactivar";

/**
 * Pausar, dar de baja o reactivar una empresa. Solo cambia `status` (y las
 * fechas que ya existen); el bloqueo de acceso lo hace requireSession().
 *   pausar    → suspended
 *   dar_baja  → cancelled + cancelled_at
 *   reactivar → active (vale también para pasar una «Prueba» a «Activa»)
 */
export async function cambiarEstadoEmpresaSafeAction(
  companyId: string,
  accion: AccionEstadoEmpresa,
): Promise<Resultado<{ status: string }>> {
  try {
    await ensureSuperadmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = (await createClient()) as any;
    const { data: empresa, error: e1 } = await supabase
      .from("companies")
      .select("id, name, status, activated_at")
      .eq("id", companyId)
      .maybeSingle();
    if (e1) throw e1;
    if (!empresa) return { ok: false, error: "La empresa no existe" };

    const ahora = new Date().toISOString();
    const update: Record<string, unknown> = {};
    if (accion === "pausar") {
      if (empresa.status === "suspended") return { ok: false, error: "Ya está pausada" };
      if (empresa.status === "cancelled")
        return { ok: false, error: "Está de baja: reactívala antes de pausarla" };
      update.status = "suspended";
    } else if (accion === "dar_baja") {
      if (empresa.status === "cancelled") return { ok: false, error: "Ya está de baja" };
      update.status = "cancelled";
      update.cancelled_at = ahora;
    } else if (accion === "reactivar") {
      if (empresa.status === "active") return { ok: false, error: "Ya está activa" };
      update.status = "active";
      update.cancelled_at = null;
      if (!empresa.activated_at) update.activated_at = ahora;
    } else {
      return { ok: false, error: "Acción no válida" };
    }

    const { error: e2 } = await supabase.from("companies").update(update).eq("id", companyId);
    if (e2) throw e2;

    await logSuperadminAction({
      action:
        accion === "pausar"
          ? "company.paused"
          : accion === "dar_baja"
            ? "company.cancelled"
            : "company.reactivated",
      affected_company_id: companyId,
      payload: { name: empresa.name, from: empresa.status, to: update.status },
    });

    revalidatePath("/superadmin");
    revalidatePath(`/superadmin/empresas/${companyId}`);
    return { ok: true, status: update.status as string };
  } catch (e) {
    return { ok: false, error: toActionError(e, "cambiarEstadoEmpresa") };
  }
}

export interface ResumenBorradoEmpresa {
  name: string;
  filas: number;
  ficheros_borrados: number;
  ficheros_fallidos: number;
  usuarios_borrados: number;
  usuarios_fallidos: number;
}

/**
 * Borrado DEFINITIVO de una empresa.
 *
 * 1. Comprobaciones en código (protegida, nombre escrito, no activa). La
 *    función SQL las repite: ninguna capa se fía de la otra.
 * 2. `borrar_empresa_definitiva` (migración 20261127110000) borra los datos
 *    en una sola transacción y devuelve los usuarios de Auth que solo eran de
 *    esta empresa y los ficheros de Storage con su prefijo.
 * 3. Con la base de datos ya limpia, se borran los ficheros y las cuentas.
 *    Si algo de esto falla, los datos ya no están: se cuenta en el resumen y
 *    en la auditoría para limpiarlo a mano.
 */
export async function borrarEmpresaDefinitivaSafeAction(
  companyId: string,
  nombreEscrito: string,
): Promise<Resultado<{ resumen: ResumenBorradoEmpresa }>> {
  try {
    const session = await ensureSuperadmin();
    if (esEmpresaProtegida(companyId)) {
      return { ok: false, error: "Esta empresa está protegida y no se puede borrar" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: empresa, error: e1 } = await admin
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .maybeSingle();
    if (e1) throw e1;
    if (!empresa) return { ok: false, error: "La empresa no existe" };
    if (esEmpresaProtegida(companyId, empresa.protegida)) {
      return { ok: false, error: "Esta empresa está protegida y no se puede borrar" };
    }
    if ((nombreEscrito ?? "").trim() !== String(empresa.name ?? "").trim()) {
      return { ok: false, error: "El nombre escrito no coincide con el de la empresa" };
    }
    if (empresa.status === "active") {
      return {
        ok: false,
        error: "Una empresa activa no se puede borrar: pausa o da de baja la empresa antes",
      };
    }

    const { data: r, error: e2 } = await admin.rpc("borrar_empresa_definitiva", {
      p_company_id: companyId,
      p_confirmar_nombre: nombreEscrito,
      p_actor: session.user_id,
    });
    if (e2) {
      const code = (e2 as { code?: string }).code;
      if (code === "PGRST202" || code === "42883") {
        return {
          ok: false,
          error:
            "Falta aplicar la migración 20261127110000 (función de borrado). No se ha borrado nada.",
        };
      }
      throw e2;
    }

    const filas = Object.values((r?.filas ?? {}) as Record<string, number>).reduce(
      (s, n) => s + Number(n || 0),
      0,
    );

    // Storage: por bucket, en lotes de 100.
    const ficheros = ((r?.ficheros ?? []) as Array<{ bucket: string; name: string }>).filter(
      (f) => f.bucket && f.name && f.name.startsWith(`${companyId}/`),
    );
    const porBucket = new Map<string, string[]>();
    for (const f of ficheros) {
      const lista = porBucket.get(f.bucket) ?? [];
      lista.push(f.name);
      porBucket.set(f.bucket, lista);
    }
    let ficherosBorrados = 0;
    let ficherosFallidos = 0;
    for (const [bucket, rutas] of porBucket) {
      for (let i = 0; i < rutas.length; i += 100) {
        const lote = rutas.slice(i, i + 100);
        const { data: quitados, error } = await admin.storage.from(bucket).remove(lote);
        if (error) {
          ficherosFallidos += lote.length;
          console.error("[borrarEmpresa] storage", bucket, error);
        } else {
          const n = Array.isArray(quitados) ? quitados.length : lote.length;
          ficherosBorrados += n;
          ficherosFallidos += lote.length - n;
        }
      }
    }

    // Auth: solo las cuentas que la función SQL ha dado por exclusivas.
    const usuarios = ((r?.usuarios ?? []) as string[]).filter(
      (u) => typeof u === "string" && u !== session.user_id,
    );
    let usuariosBorrados = 0;
    const usuariosFallidos: string[] = [];
    for (const uid of usuarios) {
      const { error } = await admin.auth.admin.deleteUser(uid);
      if (error) {
        usuariosFallidos.push(uid);
        console.error("[borrarEmpresa] auth", uid, error);
      } else {
        usuariosBorrados += 1;
      }
    }

    const resumen: ResumenBorradoEmpresa = {
      name: empresa.name,
      filas,
      ficheros_borrados: ficherosBorrados,
      ficheros_fallidos: ficherosFallidos,
      usuarios_borrados: usuariosBorrados,
      usuarios_fallidos: usuariosFallidos.length,
    };

    // La función SQL ya dejó «company.deleted.db»; esta entrada añade lo de
    // fuera de la base de datos. affected_company_id va a null: la empresa ya
    // no existe y la FK lo exige.
    await logSuperadminAction({
      action: "company.deleted",
      affected_company_id: null,
      subject_type: "company",
      subject_id: companyId,
      payload: {
        ...resumen,
        slug: empresa.slug,
        usuarios_no_borrados: usuariosFallidos,
      },
    });

    revalidatePath("/superadmin");
    return { ok: true, resumen };
  } catch (e) {
    return { ok: false, error: toActionError(e, "borrarEmpresaDefinitiva") };
  }
}
