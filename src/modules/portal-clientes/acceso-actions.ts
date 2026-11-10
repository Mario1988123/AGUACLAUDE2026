"use server";

// =============================================================================
// Portal de clientes — acciones de la OFICINA (ficha de cliente del CRM).
//
// Crear el acceso, generar contraseña nueva, enviarla por correo, desactivar y
// reactivar. Solo company_admin. La contraseña en claro NUNCA se guarda: se
// devuelve una vez a la pantalla para copiarla o mandarla.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import {
  dniValidoParaPortal,
  emailSinteticoPortal,
  generarClavePortal,
  normalizarDni,
} from "./comun";

export interface EstadoAccesoPortal {
  existe: boolean;
  activo: boolean;
  usuario: string | null;
  ultimo_acceso: string | null;
  clave_cambiada_el: string | null;
  clave_enviada_el: string | null;
  clave_enviada_por: string | null;
  bloqueado_hasta: string | null;
  /** Motivo por el que no se puede crear (DNI vacío, inválido, comodín…). */
  bloqueo_alta: string | null;
  email_cliente: string | null;
  telefono_cliente: string | null;
}

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

async function exigirAdminEmpresa() {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin")) {
    throw new Error("Solo el administrador de la empresa puede gestionar el acceso al portal");
  }
  return { session, companyId: session.company_id as string };
}

async function leerCliente(admin: Admin, companyId: string, customerId: string) {
  const { data, error } = await admin
    .from("customers")
    .select("id, tax_id, email, phone_primary, first_name, last_name, legal_name, trade_name, party_kind, deleted_at")
    .eq("id", customerId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.deleted_at) throw new Error("Cliente no encontrado");
  return data as {
    id: string;
    tax_id: string | null;
    email: string | null;
    phone_primary: string | null;
    first_name: string | null;
    last_name: string | null;
    legal_name: string | null;
    trade_name: string | null;
    party_kind: string;
  };
}

function nombreCliente(c: {
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
  trade_name: string | null;
}): string {
  return (
    [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
    c.trade_name ||
    c.legal_name ||
    ""
  );
}

async function leerCuenta(admin: Admin, companyId: string, customerId: string) {
  const { data, error } = await admin
    .from("customer_portal_accounts")
    .select(
      "id, user_id, login_tax_id, status, last_login_at, password_set_at, password_sent_at, password_sent_via, locked_until",
    )
    .eq("company_id", companyId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as {
    id: string;
    user_id: string;
    login_tax_id: string;
    status: "active" | "disabled";
    last_login_at: string | null;
    password_set_at: string | null;
    password_sent_at: string | null;
    password_sent_via: string | null;
    locked_until: string | null;
  } | null;
}

export async function estadoAccesoPortalAction(
  customerId: string,
): Promise<Resultado<{ estado: EstadoAccesoPortal }>> {
  try {
    const { companyId } = await exigirAdminEmpresa();
    const admin = createAdminClient() as Admin;
    const cliente = await leerCliente(admin, companyId, customerId);
    const cuenta = await leerCuenta(admin, companyId, customerId);

    let bloqueoAlta: string | null = null;
    if (!cuenta) {
      if (!cliente.tax_id) bloqueoAlta = "El cliente no tiene DNI/CIF. Añádelo en «Datos» para poder darle acceso.";
      else if (!dniValidoParaPortal(cliente.tax_id))
        bloqueoAlta = "El DNI/CIF del cliente no es válido o es el comodín de venta al contado.";
    }

    return {
      ok: true,
      estado: {
        existe: !!cuenta,
        activo: cuenta?.status === "active",
        usuario: cuenta?.login_tax_id ?? (cliente.tax_id ? normalizarDni(cliente.tax_id) : null),
        ultimo_acceso: cuenta?.last_login_at ?? null,
        clave_cambiada_el: cuenta?.password_set_at ?? null,
        clave_enviada_el: cuenta?.password_sent_at ?? null,
        clave_enviada_por: cuenta?.password_sent_via ?? null,
        bloqueado_hasta:
          cuenta?.locked_until && new Date(cuenta.locked_until) > new Date()
            ? cuenta.locked_until
            : null,
        bloqueo_alta: bloqueoAlta,
        email_cliente: cliente.email,
        telefono_cliente: cliente.phone_primary,
      },
    };
  } catch (e) {
    return { ok: false, error: toActionError(e, "portal.estado") };
  }
}

/**
 * Crea el acceso (si no existe) o genera una contraseña nueva (si existe).
 * Devuelve la contraseña en claro UNA vez.
 */
export async function generarAccesoPortalAction(
  customerId: string,
): Promise<Resultado<{ usuario: string; clave: string; nuevo: boolean }>> {
  try {
    const { session, companyId } = await exigirAdminEmpresa();
    const admin = createAdminClient() as Admin;
    const cliente = await leerCliente(admin, companyId, customerId);
    const cuenta = await leerCuenta(admin, companyId, customerId);
    const clave = generarClavePortal();

    if (cuenta) {
      // Contraseña nueva para un acceso que ya existe.
      const { error } = await admin.auth.admin.updateUserById(cuenta.user_id, { password: clave });
      if (error) throw new Error(`No se pudo cambiar la contraseña: ${error.message}`);
      // Si estaba desactivado, lo reactivamos también en Auth.
      if (cuenta.status !== "active") {
        await admin.auth.admin.updateUserById(cuenta.user_id, { ban_duration: "none" });
      }
      await admin
        .from("customer_portal_accounts")
        .update({
          status: "active",
          password_set_at: new Date().toISOString(),
          password_sent_at: null,
          password_sent_via: null,
          failed_attempts: 0,
          locked_until: null,
        })
        .eq("id", cuenta.id);
      await registrarEvento(admin, companyId, customerId, session.user_id, "customer.portal_password_reset");
      revalidatePath(`/clientes/${customerId}`);
      return { ok: true, usuario: cuenta.login_tax_id, clave, nuevo: false };
    }

    // Alta nueva
    if (!dniValidoParaPortal(cliente.tax_id)) {
      throw new Error("El DNI/CIF del cliente no es válido o es el comodín de venta al contado.");
    }
    const usuario = normalizarDni(cliente.tax_id);

    // Otro cliente de la misma empresa con el mismo DNI que ya tiene acceso.
    const { data: dup } = await admin
      .from("customer_portal_accounts")
      .select("id, customer_id")
      .eq("company_id", companyId)
      .eq("login_tax_id", usuario)
      .maybeSingle();
    if (dup) {
      throw new Error(
        "Ya hay otro cliente de tu empresa con este mismo DNI/CIF que tiene acceso al portal. Revisa si es un duplicado.",
      );
    }

    const cuentaId = crypto.randomUUID();
    const authEmail = emailSinteticoPortal(cuentaId);
    const { data: creado, error: errAuth } = await admin.auth.admin.createUser({
      email: authEmail,
      password: clave,
      email_confirm: true,
      user_metadata: { full_name: nombreCliente(cliente), portal_cliente: true },
      app_metadata: { portal_cliente: true },
    });
    if (errAuth || !creado?.user) {
      throw new Error(`No se pudo crear el usuario: ${errAuth?.message ?? "desconocido"}`);
    }

    const { error: errIns } = await admin.from("customer_portal_accounts").insert({
      id: cuentaId,
      company_id: companyId,
      customer_id: customerId,
      user_id: creado.user.id,
      login_tax_id: usuario,
      auth_email: authEmail,
      created_by: session.user_id,
    });
    if (errIns) {
      // Deshacer el usuario de Auth para no dejar huérfanos.
      await admin.auth.admin.deleteUser(creado.user.id).catch(() => undefined);
      throw new Error(`No se pudo guardar el acceso: ${errIns.message}`);
    }

    await registrarEvento(admin, companyId, customerId, session.user_id, "customer.portal_access_created");
    revalidatePath(`/clientes/${customerId}`);
    return { ok: true, usuario, clave, nuevo: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "portal.generar") };
  }
}

/** Envía usuario y contraseña al email del cliente. */
export async function enviarAccesoPorCorreoAction(
  customerId: string,
  clave: string,
): Promise<Resultado> {
  try {
    const { companyId } = await exigirAdminEmpresa();
    const admin = createAdminClient() as Admin;
    const cliente = await leerCliente(admin, companyId, customerId);
    const cuenta = await leerCuenta(admin, companyId, customerId);
    if (!cuenta) throw new Error("El cliente todavía no tiene acceso");
    if (!cliente.email) throw new Error("El cliente no tiene email");
    if (!/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(clave)) {
      throw new Error("Contraseña con formato no válido");
    }
    // Que sea la contraseña vigente: no mandar al cliente una que no funciona.
    if (!(await claveEsVigente(cuenta.user_id, admin, clave))) {
      throw new Error("Esa contraseña ya no es la vigente. Genera una nueva.");
    }

    const { siteBaseUrl } = await import("@/shared/lib/site-url");
    const { sendTransactionalEmail } = await import("@/modules/mailing/actions");
    const r = await sendTransactionalEmail({
      template_key: "portal_access",
      to_email: cliente.email,
      to_name: nombreCliente(cliente) || undefined,
      customer_id: customerId,
      variables: {
        customer_first_name: cliente.first_name ?? nombreCliente(cliente),
        portal_user: cuenta.login_tax_id,
        portal_password: clave,
        portal_url: `${siteBaseUrl()}/portal/entrar`,
      },
      related_subject_type: "customer",
      related_subject_id: customerId,
      // La contraseña viaja en el correo pero no se guarda en el historial
      // (email_outbox lo ve cualquier empleado de la empresa).
      ocultar_en_registro: [clave],
    });
    if (!r.ok) throw new Error(r.error ?? "No se pudo enviar el correo");

    await marcarEnviada(admin, cuenta.id, "email");
    revalidatePath(`/clientes/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "portal.enviar_correo") };
  }
}

/** Anota que la contraseña se mandó por WhatsApp o se entregó en mano. */
export async function marcarAccesoEnviadoAction(
  customerId: string,
  via: "whatsapp" | "manual",
): Promise<Resultado> {
  try {
    const { companyId } = await exigirAdminEmpresa();
    if (via !== "whatsapp" && via !== "manual") throw new Error("Vía no válida");
    const admin = createAdminClient() as Admin;
    const cuenta = await leerCuenta(admin, companyId, customerId);
    if (!cuenta) throw new Error("El cliente todavía no tiene acceso");
    await marcarEnviada(admin, cuenta.id, via);
    revalidatePath(`/clientes/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "portal.marcar_enviado") };
  }
}

export async function cambiarEstadoAccesoPortalAction(
  customerId: string,
  activar: boolean,
): Promise<Resultado> {
  try {
    const { session, companyId } = await exigirAdminEmpresa();
    const admin = createAdminClient() as Admin;
    const cuenta = await leerCuenta(admin, companyId, customerId);
    if (!cuenta) throw new Error("El cliente no tiene acceso");
    const { error } = await admin
      .from("customer_portal_accounts")
      .update({
        status: activar ? "active" : "disabled",
        failed_attempts: 0,
        locked_until: null,
      })
      .eq("id", cuenta.id);
    if (error) throw new Error(error.message);
    // El bloqueo en Auth impide entrar y renovar la sesión; el portal además
    // comprueba el estado de la cuenta en cada petición.
    const { error: errBan } = await admin.auth.admin.updateUserById(cuenta.user_id, {
      ban_duration: activar ? "none" : "876000h",
    });
    if (errBan) console.error("[portal] ban_duration falló:", errBan.message);
    await registrarEvento(
      admin,
      companyId,
      customerId,
      session.user_id,
      activar ? "customer.portal_access_enabled" : "customer.portal_access_disabled",
    );
    revalidatePath(`/clientes/${customerId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e, "portal.estado_cambio") };
  }
}

async function marcarEnviada(admin: Admin, cuentaId: string, via: "email" | "whatsapp" | "manual") {
  await admin
    .from("customer_portal_accounts")
    .update({ password_sent_at: new Date().toISOString(), password_sent_via: via })
    .eq("id", cuentaId);
}

async function registrarEvento(
  admin: Admin,
  companyId: string,
  customerId: string,
  userId: string,
  kind: string,
) {
  try {
    await admin.from("events").insert({
      company_id: companyId,
      subject_type: "customer",
      subject_id: customerId,
      kind,
      payload: {},
      actor_user_id: userId,
    });
  } catch {
    /* el evento es informativo */
  }
}

async function claveEsVigente(userId: string, admin: Admin, clave: string): Promise<boolean> {
  const { data } = await admin
    .from("customer_portal_accounts")
    .select("auth_email")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.auth_email) return false;
  const { createClient: crearPlano } = await import("@supabase/supabase-js");
  const { publicEnv } = await import("@/shared/lib/env");
  const plano = crearPlano(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await plano.auth.signInWithPassword({ email: data.auth_email, password: clave });
  if (error) return false;
  await plano.auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}
