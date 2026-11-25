/**
 * Ciclo de vida de una empresa (2026-11-27).
 *
 * No hay columna nueva: se usa `companies.status` (enum app.company_status):
 *   trial     → Prueba   (entra con normalidad)
 *   active    → Activa
 *   suspended → Pausada  (nadie de la empresa entra; los datos siguen)
 *   cancelled → De baja  (nadie entra; los datos se conservan hasta que se borre)
 *
 * El bloqueo lo aplica `requireSession()` y nunca afecta al superadmin.
 */

export type EstadoEmpresa = "trial" | "active" | "suspended" | "cancelled";

/** Empresas que no se pueden borrar nunca. Van también fijas en la función SQL
 *  `borrar_empresa_definitiva` y en el trigger de `companies`. */
export const EMPRESAS_PROTEGIDAS: readonly string[] = [
  "1d5d958b-9ce4-4bd9-8db9-0a4884765e0f", // aquaroo
  "f02d586c-0dc6-49e4-83e5-e0f6e688237c", // INFINITY AQUA
];

export function esEmpresaProtegida(id: string, columnaProtegida?: boolean | null): boolean {
  return columnaProtegida === true || EMPRESAS_PROTEGIDAS.includes(id);
}

/**
 * Estados en los que una empresa está EN SERVICIO: entra su gente y corren
 * sus procesos automáticos (crons, avisos, correos, push, WhatsApp, visitas,
 * cobros). Pausada (suspended) y de baja (cancelled) no generan nada
 * automático (Mario 2026-11-28). Un estado desconocido o nulo NO cuenta como
 * en servicio.
 */
export const ESTADOS_EN_SERVICIO: readonly EstadoEmpresa[] = ["trial", "active"];

export function empresaEnServicio(status: string | null | undefined): boolean {
  return status === "trial" || status === "active";
}

export type MotivoBloqueo = "pausada" | "baja";

/** Motivo por el que los usuarios de la empresa no pueden entrar, o null. */
export function motivoBloqueoEmpresa(status: string | null | undefined): MotivoBloqueo | null {
  if (status === "suspended") return "pausada";
  if (status === "cancelled") return "baja";
  return null;
}

type Tono = "success" | "onhold" | "rejected" | "neutral" | "info";

export const ESTADO_EMPRESA: Record<EstadoEmpresa, { label: string; tono: Tono }> = {
  trial: { label: "Prueba", tono: "info" },
  active: { label: "Activa", tono: "success" },
  suspended: { label: "Pausada", tono: "onhold" },
  cancelled: { label: "De baja", tono: "neutral" },
};

export function estadoEmpresa(status: string | null | undefined) {
  return ESTADO_EMPRESA[(status as EstadoEmpresa) ?? "trial"] ?? {
    label: status ?? "—",
    tono: "neutral" as Tono,
  };
}

/** Textos que ve el usuario de la empresa al intentar entrar. */
export const MENSAJE_BLOQUEO: Record<MotivoBloqueo | "usuario", { titulo: string; texto: string }> = {
  pausada: {
    titulo: "El acceso de tu empresa está en pausa",
    texto:
      "El plan de tu empresa está pausado y de momento nadie puede entrar. Tus datos siguen guardados. Para reactivarlo, habla con el responsable de tu empresa o escríbenos.",
  },
  baja: {
    titulo: "Tu empresa está dada de baja",
    texto:
      "Tu empresa ya no tiene acceso a Hidromanager. Los datos se conservan; si quieres volver o necesitas una copia, habla con el responsable de tu empresa o escríbenos.",
  },
  usuario: {
    titulo: "Tu usuario está desactivado",
    texto:
      "El administrador de tu empresa ha desactivado tu acceso. Si crees que es un error, habla con él.",
  },
};
