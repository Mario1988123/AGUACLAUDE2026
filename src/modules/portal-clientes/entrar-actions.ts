"use server";

// =============================================================================
// Portal de clientes — entrar, cambiar contraseña. Sin sesión de empleado.
// =============================================================================

import { headers } from "next/headers";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { publicEnv } from "@/shared/lib/env";
import { checkRate } from "@/shared/lib/rate-limit";
import { toActionError } from "@/shared/lib/actions/safe-error";
import {
  PORTAL_MAX_INTENTOS,
  PORTAL_MINUTOS_BLOQUEO,
  dniValidoParaPortal,
  normalizarDni,
} from "./comun";
import { requireSesionPortal } from "./sesion";

type Resultado = { ok: true } | { ok: false; error: string };

const ERROR_GENERICO = `DNI o contraseña incorrectos. Tras ${PORTAL_MAX_INTENTOS} intentos fallidos el acceso se bloquea ${PORTAL_MINUTOS_BLOQUEO} minutos.`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

async function ipCliente(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "sin-ip";
}

/** Intento contra Auth con un email que no existe: tarda lo mismo que uno real. */
async function intentoFicticio() {
  const plano = createPlainClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  await plano.auth
    .signInWithPassword({ email: "cliente-inexistente@clientes.hidromanager.es", password: "x".repeat(16) })
    .catch(() => undefined);
}

export async function entrarPortalAction(input: {
  dni: string;
  clave: string;
}): Promise<Resultado> {
  try {
    const dni = normalizarDni(input?.dni);
    const clave = String(input?.clave ?? "").trim();
    if (!dni || !clave) return { ok: false, error: "Escribe tu DNI y tu contraseña." };
    if (!dniValidoParaPortal(dni)) {
      return { ok: false, error: "Revisa el DNI: no parece correcto." };
    }

    // Freno por IP y por DNI en esta instancia (el bloqueo de verdad va en BD).
    const ip = await ipCliente();
    if (!checkRate(`portal-login-ip:${ip}`, 20, 10 * 60_000) || !checkRate(`portal-login-dni:${dni}`, 10, 10 * 60_000)) {
      return { ok: false, error: "Demasiados intentos. Espera unos minutos y vuelve a probar." };
    }

    const admin = createAdminClient() as Admin;
    const { data: cuentas, error } = await admin
      .from("customer_portal_accounts")
      .select("id, auth_email, locked_until")
      .eq("login_tax_id", dni)
      .eq("status", "active")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ahora = new Date();
    // Las bloqueadas ni se prueban. El mensaje es SIEMPRE el mismo (no revela
    // si el DNI tiene acceso ni si está bloqueado).
    const lista = ((cuentas ?? []) as Array<{ id: string; auth_email: string; locked_until: string | null }>)
      .filter((c) => !c.locked_until || new Date(c.locked_until) <= ahora);

    if (lista.length === 0) {
      // Igualar el tiempo con un intento real contra Auth.
      await intentoFicticio();
      return { ok: false, error: ERROR_GENERICO };
    }

    const supabase = await createClient();
    const fallidas: string[] = [];
    for (const c of lista) {
      const { error: errLogin } = await supabase.auth.signInWithPassword({
        email: c.auth_email,
        password: clave,
      });
      if (!errLogin) {
        await admin
          .from("customer_portal_accounts")
          .update({ failed_attempts: 0, locked_until: null, last_login_at: ahora.toISOString() })
          .eq("id", c.id);
        // Mismo DNI en otra empresa: no penalizarla por un acierto en esta.
        return { ok: true };
      }
      fallidas.push(c.id);
    }

    // Ninguna acertó: suma el fallo de forma atómica (resiste peticiones en paralelo).
    for (const id of fallidas) {
      await admin.rpc("portal_registrar_fallo", {
        p_cuenta: id,
        p_max: PORTAL_MAX_INTENTOS,
        p_minutos: PORTAL_MINUTOS_BLOQUEO,
      });
    }
    return { ok: false, error: ERROR_GENERICO };
  } catch (e) {
    return { ok: false, error: toActionError(e, "portal.entrar") };
  }
}

/** El cliente cambia su contraseña desde el portal (pide la actual). */
export async function cambiarClavePortalAction(input: {
  actual: string;
  nueva: string;
}): Promise<Resultado> {
  try {
    const sesion = await requireSesionPortal();
    const actual = String(input?.actual ?? "");
    const nueva = String(input?.nueva ?? "");
    if (nueva.length < 10) {
      return { ok: false, error: "La contraseña nueva debe tener al menos 10 caracteres." };
    }
    if (nueva === actual) return { ok: false, error: "La contraseña nueva es igual que la actual." };
    if (!checkRate(`portal-clave:${sesion.user_id}`, 5, 10 * 60_000)) {
      return { ok: false, error: "Demasiados intentos. Espera unos minutos." };
    }

    const admin = createAdminClient() as Admin;
    const { data: cuenta } = await admin
      .from("customer_portal_accounts")
      .select("auth_email")
      .eq("id", sesion.cuenta_id)
      .maybeSingle();
    if (!cuenta) return { ok: false, error: "Acceso no encontrado." };

    // Comprobar la contraseña actual con un cliente sin cookies (no toca la
    // sesión del navegador).
    const comprobador = createPlainClient(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { error: errActual } = await comprobador.auth.signInWithPassword({
      email: cuenta.auth_email,
      password: actual,
    });
    if (errActual) return { ok: false, error: "La contraseña actual no es correcta." };
    // scope local: revoca SOLO la sesión de la comprobación, no la del navegador.
    await comprobador.auth.signOut({ scope: "local" }).catch(() => undefined);

    const { error } = await admin.auth.admin.updateUserById(sesion.user_id, { password: nueva });
    if (error) {
      const msg = /pwned|leaked|weak|compromised/i.test(error.message)
        ? "Esa contraseña aparece en filtraciones conocidas. Elige otra."
        : `No se pudo cambiar: ${error.message}`;
      return { ok: false, error: msg };
    }
    await admin
      .from("customer_portal_accounts")
      .update({ password_set_at: new Date().toISOString() })
      .eq("id", sesion.cuenta_id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "portal.cambiar_clave") };
  }
}
