/**
 * Tipos compartidos del envío de push (web, APNs y FCM).
 */

/** Lo que viaja en una notificación push, sea cual sea el canal. */
export interface AvisoPush {
  title: string;
  body?: string;
  /** Ruta interna a la que se navega al tocar la notificación ("/incidencias"). */
  url?: string;
  /** Agrupa: una notificación nueva con el mismo tag sustituye a la anterior. */
  tag?: string;
  icon?: string;
}

/** Resultado del envío a UN dispositivo nativo. */
export interface ResultadoEnvioNativo {
  token: string;
  ok: boolean;
  /** true si el servicio dice que el token ya no existe: hay que borrarlo. */
  borrar: boolean;
  /** Motivo del fallo tal como lo devuelve APNs o FCM (para el log). */
  motivo?: string;
}

/** Canal de notificaciones de Android. Tiene que coincidir con el de
 *  movil/android (MainActivity.java y AndroidManifest.xml). */
export const CANAL_ANDROID = "avisos";

/** Icono monocromo de la notificación en Android (res/drawable). */
export const ICONO_ANDROID = "ic_stat_notificacion";

/** Deja constancia en el log UNA vez por arranque del servidor, no en cada envío. */
const avisados = new Set<string>();
export function avisarUnaVez(clave: string, mensaje: string): void {
  if (avisados.has(clave)) return;
  avisados.add(clave);
  console.warn(`[push] ${mensaje}`);
}
