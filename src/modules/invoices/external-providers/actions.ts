"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { isMasterKeyConfigured } from "@/shared/lib/crypto/aes-gcm";
import { cifrarParaBytea, descifrarDeBytea } from "./cifrado";
import type { ProviderId, ProviderCredentials } from "./types";
import { findProvider, getProviderClient, selectableProviders } from "./registry";
import { toActionError } from "@/shared/lib/actions/safe-error";

async function ensureAdmin() {
  const session = await requireSession();
  if (session.is_superadmin) return session;
  if (!session.company_id) throw new Error("Sin empresa");
  if (!session.roles.includes("company_admin")) {
    throw new Error("Solo el admin de empresa puede configurar facturación externa");
  }
  return session;
}

export interface ProviderSettingsRow {
  provider: ProviderId;
  environment: "sandbox" | "production";
  has_api_key: boolean;
  has_extra: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  /** Registro automático en VeriFactu activado (solo Verifacti). */
  activo: boolean;
}

/**
 * Lee la configuración actual de proveedor externo de la empresa SIN exponer
 * las credenciales descifradas (solo "tiene/no tiene"). Para mostrar en panel.
 */
export async function getExternalProviderSettings(): Promise<ProviderSettingsRow> {
  const session = await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const columnas = `external_invoicing_provider, external_invoicing_environment,
       external_invoicing_api_key_encrypted, external_invoicing_extra_encrypted,
       external_invoicing_last_test_at, external_invoicing_last_test_ok,
       external_invoicing_last_test_error`;
  let res = await admin
    .from("company_settings")
    .select(columnas + ", external_invoicing_activo")
    .eq("company_id", session.company_id)
    .maybeSingle();
  // Sin la migración 20261003090000 la columna no existe: se lee sin ella.
  if (res.error) {
    res = await admin
      .from("company_settings")
      .select(columnas)
      .eq("company_id", session.company_id)
      .maybeSingle();
  }
  const row = res.data as Record<string, unknown> | null;
  return {
    provider: ((row?.external_invoicing_provider as ProviderId) ?? "none") as ProviderId,
    environment:
      ((row?.external_invoicing_environment as
        | "sandbox"
        | "production"
        | null) ?? "sandbox") as "sandbox" | "production",
    has_api_key: !!row?.external_invoicing_api_key_encrypted,
    has_extra: !!row?.external_invoicing_extra_encrypted,
    last_test_at: (row?.external_invoicing_last_test_at as string | null) ?? null,
    last_test_ok: (row?.external_invoicing_last_test_ok as boolean | null) ?? null,
    last_test_error:
      (row?.external_invoicing_last_test_error as string | null) ?? null,
    activo: row?.external_invoicing_activo === true,
  };
}

/**
 * Guarda la elección de proveedor + credenciales. Si el admin cambia el
 * provider a 'none', limpia las credenciales para no dejar restos cifrados.
 */
export async function saveExternalProviderAction(input: {
  provider: ProviderId;
  environment: "sandbox" | "production";
  api_key?: string | null;
  extra?: Record<string, string> | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    const meta = findProvider(input.provider);
    if (!meta) return { ok: false, error: "Proveedor desconocido" };

    if (input.provider !== "none" && !isMasterKeyConfigured()) {
      return {
        ok: false,
        error:
          "VERIFACTU_MASTER_KEY no configurada en el servidor. Pide al equipo técnico que la añada antes de guardar credenciales cifradas.",
      };
    }

    const payload: Record<string, unknown> = {
      external_invoicing_provider: input.provider,
      external_invoicing_environment: input.environment,
    };
    if (input.provider === "none") {
      payload.external_invoicing_api_key_encrypted = null;
      payload.external_invoicing_extra_encrypted = null;
      payload.external_invoicing_last_test_at = null;
      payload.external_invoicing_last_test_ok = null;
      payload.external_invoicing_last_test_error = null;
    } else {
      if (input.api_key && input.api_key.trim()) {
        payload.external_invoicing_api_key_encrypted = cifrarParaBytea(
          input.api_key.trim(),
        );
        // Clave nueva: hay que volver a probarla antes de enviar nada.
        payload.external_invoicing_last_test_ok = null;
        payload.external_invoicing_last_test_at = null;
        payload.external_invoicing_last_test_error = null;
      }
      if (input.extra && Object.keys(input.extra).length > 0) {
        payload.external_invoicing_extra_encrypted = cifrarParaBytea(
          JSON.stringify(input.extra),
        );
      } else if (input.extra && Object.keys(input.extra).length === 0) {
        // Admin pidió explícitamente quitar extras.
        payload.external_invoicing_extra_encrypted = null;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    // Cambiar de proveedor o de clave apaga el registro automático en
    // VeriFactu hasta que se vuelva a probar y activar a mano.
    const { data: previo } = await admin
      .from("company_settings")
      .select("external_invoicing_provider")
      .eq("company_id", session.company_id)
      .maybeSingle();
    const cambiaProveedor =
      (previo as { external_invoicing_provider: string | null } | null)
        ?.external_invoicing_provider !== input.provider;
    const desactivar =
      input.provider !== "verifacti" || cambiaProveedor || !!input.api_key?.trim();
    const { data: existing } = await admin
      .from("company_settings")
      .select("company_id")
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (existing) {
      const { error } = await admin
        .from("company_settings")
        .update(payload)
        .eq("company_id", session.company_id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await admin
        .from("company_settings")
        .insert({ company_id: session.company_id, ...payload });
      if (error) return { ok: false, error: error.message };
    }

    if (desactivar) {
      // Best-effort: sin la migración la columna no existe y no hay nada que apagar.
      await admin
        .from("company_settings")
        .update({ external_invoicing_activo: false })
        .eq("company_id", session.company_id);
    }

    revalidatePath("/configuracion/facturacion");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Descifra las credenciales actuales y llama a client.testConnection. Guarda
 * el resultado en company_settings.external_invoicing_last_test_*. Se llama
 * desde el botón "Probar conexión" del panel.
 */
export async function testExternalProviderConnectionAction(): Promise<
  { ok: true; message: string } | { ok: false; error: string }
> {
  try {
    const session = await ensureAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("company_settings")
      .select(
        `external_invoicing_provider, external_invoicing_environment,
         external_invoicing_api_key_encrypted, external_invoicing_extra_encrypted,
         fiscal_tax_id`,
      )
      .eq("company_id", session.company_id)
      .maybeSingle();
    const row = data as Record<string, unknown> | null;
    if (!row) return { ok: false, error: "Sin configuración" };
    const provider = (row.external_invoicing_provider as ProviderId) ?? "none";
    if (provider === "none") {
      return { ok: false, error: "Selecciona un proveedor antes de probar." };
    }
    const apiKeyEnc = row.external_invoicing_api_key_encrypted as
      | string
      | null;
    const extraEnc = row.external_invoicing_extra_encrypted as string | null;
    if (!apiKeyEnc) return { ok: false, error: "Falta API key del proveedor." };
    const creds: ProviderCredentials = {
      api_key: descifrarDeBytea(apiKeyEnc),
      environment:
        ((row.external_invoicing_environment as
          | "sandbox"
          | "production"
          | null) ?? "sandbox") as "sandbox" | "production",
      extra: extraEnc
        ? (JSON.parse(descifrarDeBytea(extraEnc)) as Record<string, string>)
        : undefined,
    };
    const client = await getProviderClient(provider);
    let r = await client.testConnection(creds);
    const extraUpdate: Record<string, unknown> = {};

    // Verifacti: la API key es de UN NIF y de UN entorno. Se comprueba que
    // el NIF sea el de la empresa (una clave de otra empresa registraría sus
    // facturas a nombre ajeno) y se toma el entorno que dice la propia clave.
    if (provider === "verifacti" && r.ok) {
      const { normalizarNif } = await import("./verifacti-mapeo");
      const nifClave = normalizarNif(r.account_info?.nif ?? null);
      const nifEmpresa = normalizarNif((row.fiscal_tax_id as string | null) ?? null);
      if (!nifEmpresa) {
        r = {
          ok: false,
          message:
            "Tu empresa no tiene NIF en sus datos fiscales. Rellénalo antes de conectar Verifacti.",
        };
      } else if (nifClave !== nifEmpresa) {
        r = {
          ok: false,
          message: `La API key es del NIF ${nifClave ?? "desconocido"}, pero el NIF de tu empresa es ${nifEmpresa}. Usa la API key de tu NIF.`,
        };
      } else {
        extraUpdate.external_invoicing_environment =
          r.account_info?.entorno === "test" ? "sandbox" : "production";
      }
    }

    await admin
      .from("company_settings")
      .update({
        external_invoicing_last_test_at: new Date().toISOString(),
        external_invoicing_last_test_ok: r.ok,
        external_invoicing_last_test_error: r.ok ? null : r.message,
        ...extraUpdate,
      })
      .eq("company_id", session.company_id);
    if (!r.ok) {
      // Best-effort (sin migración la columna no existe).
      await admin
        .from("company_settings")
        .update({ external_invoicing_activo: false })
        .eq("company_id", session.company_id);
    }
    revalidatePath("/configuracion/facturacion");
    return r.ok
      ? { ok: true, message: r.message }
      : { ok: false, error: r.message };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Activa o desactiva el registro automático en VeriFactu vía Verifacti.
 * Activar exige: proveedor Verifacti, API key guardada, última prueba de
 * conexión correcta y el envío directo a la AEAT apagado.
 */
export async function setVerifactiActivoAction(
  activo: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await ensureAdmin();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    if (activo) {
      const { data } = await admin
        .from("company_settings")
        .select(
          "external_invoicing_provider, external_invoicing_api_key_encrypted, external_invoicing_last_test_ok, verifactu_mode",
        )
        .eq("company_id", session.company_id)
        .maybeSingle();
      const row = (data ?? {}) as Record<string, unknown>;
      if (row.external_invoicing_provider !== "verifacti") {
        return { ok: false, error: "Elige Verifacti como proveedor y guarda antes de activarlo." };
      }
      if (!row.external_invoicing_api_key_encrypted) {
        return { ok: false, error: "Pega y guarda primero la API key de tu NIF." };
      }
      if (row.external_invoicing_last_test_ok !== true) {
        return { ok: false, error: "Prueba la conexión con Verifacti (y que salga bien) antes de activarlo." };
      }
      if (row.verifactu_mode && row.verifactu_mode !== "no_envio") {
        return {
          ok: false,
          error: "Tienes activado el envío directo a la AEAT. Desactívalo para no registrar las facturas dos veces.",
        };
      }
    }
    const { error } = await admin
      .from("company_settings")
      .update({ external_invoicing_activo: activo })
      .eq("company_id", session.company_id);
    if (error) {
      return {
        ok: false,
        error: /external_invoicing_activo|schema cache|does not exist/i.test(error.message ?? "")
          ? "Falta aplicar la migración 20261003090000_verifacti_envio_por_empresa."
          : error.message,
      };
    }
    revalidatePath("/configuracion/facturacion");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

/**
 * Devuelve la lista de proveedores seleccionables (para el dropdown del panel).
 * Es server action para no exponer registry.ts al cliente.
 */
export async function listSelectableProvidersAction(): Promise<
  Array<{
    id: ProviderId;
    name: string;
    tagline: string;
    docs_url: string;
    has_sandbox: boolean;
    status: "ready" | "skeleton" | "planned" | "incompatible";
    notes?: string;
  }>
> {
  await ensureAdmin();
  return selectableProviders();
}
