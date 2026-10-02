/**
 * Decide con qué datos se prueba una conexión SMTP (auditoría 2026-10-01, I14).
 *
 * Problema: si el formulario no traía contraseña, testSmtpAction descifraba la
 * guardada y se conectaba al host que mandaba el navegador. Un admin podía
 * apuntar el "probar" a su propio servidor y capturar la contraseña del correo
 * de un empleado (o la de la empresa).
 *
 * Regla: la contraseña guardada SOLO se usa contra el host, puerto, usuario y
 * cifrado guardados. Si el formulario los ha cambiado, hay que volver a
 * escribir la contraseña.
 */

export interface DatosSmtp {
  host: string;
  port: number;
  user: string;
  secure: boolean;
}

export interface EntradaPruebaSmtp {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password?: string;
  smtp_secure: boolean;
}

export type ResultadoConfigPrueba =
  | { ok: true; usarGuardada: false; config: DatosSmtp & { password: string } }
  | { ok: true; usarGuardada: true; config: DatosSmtp }
  | { ok: false; error: string };

/** Marcador que pinta el formulario cuando hay contraseña guardada. */
export const MARCADOR_PASSWORD = "********";

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function resolverConfigPrueba(
  entrada: EntradaPruebaSmtp,
  guardada: (DatosSmtp & { tienePassword: boolean }) | null,
): ResultadoConfigPrueba {
  const pwd = entrada.smtp_password ?? "";
  const puerto = entrada.smtp_port || 587;
  if (pwd && pwd !== MARCADOR_PASSWORD) {
    return {
      ok: true,
      usarGuardada: false,
      config: {
        host: entrada.smtp_host,
        port: puerto,
        user: entrada.smtp_user,
        secure: entrada.smtp_secure,
        password: pwd,
      },
    };
  }
  if (!guardada || !guardada.tienePassword) {
    return { ok: false, error: "Falta la contraseña. Introdúcela para probar la conexión." };
  }
  const mismoServidor =
    norm(entrada.smtp_host) === norm(guardada.host) &&
    norm(entrada.smtp_user) === norm(guardada.user) &&
    puerto === (guardada.port || 587) &&
    Boolean(entrada.smtp_secure) === Boolean(guardada.secure);
  if (!mismoServidor) {
    return {
      ok: false,
      error:
        "Has cambiado el servidor, el puerto o el usuario: vuelve a escribir la contraseña para probar la conexión.",
    };
  }
  return {
    ok: true,
    usarGuardada: true,
    config: {
      host: guardada.host,
      port: guardada.port || 587,
      user: guardada.user,
      secure: guardada.secure,
    },
  };
}
