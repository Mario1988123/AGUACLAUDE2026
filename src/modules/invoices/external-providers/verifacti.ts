import type {
  ExternalInvoicingClient,
  ProviderCredentials,
  PushInvoiceInput,
  PushInvoiceResult,
  TestConnectionResult,
} from "./types";
import {
  mensajeErrorVerifacti,
  type CuerpoAltaVerifacti,
  type CuerpoAnulacionVerifacti,
} from "./verifacti-mapeo";

/**
 * Cliente HTTP de Verifacti (https://www.verifacti.com).
 *
 * Contrastado con la especificación OpenAPI publicada por Verifacti
 * (https://www.verifacti.com/openapi/verifactu.yaml, leída el 02-10-2026):
 *  · URL base única: https://api.verifacti.com/ — el entorno (pruebas o
 *    producción) y el NIF emisor los determina la API KEY, no la URL.
 *  · Autenticación: cabecera `Authorization: Bearer <API_KEY>`.
 *  · Hay UNA API key POR NIF (se genera al dar de alta el NIF en su panel).
 *    La clave "vfn_..." de la API de gestión de NIFs no sirve para facturar.
 *  · POST /verifactu/create  → 200 { uuid, estado:"Pendiente", url, qr, huella }
 *  · POST /verifactu/cancel  → 200 { uuid, estado, huella }
 *  · GET  /verifactu/status?uuid=… → estado del registro (Pendiente, Correcto,
 *    Aceptado con errores, Incorrecto, Duplicado, Anulado, …)
 *  · GET  /verifactu/health  → { estado, nif, entorno }
 *  · Cabecera opcional `Idempotency-Key` en create/cancel (24 h por NIF).
 *  · Verifacti NO devuelve el CSV de la AEAT en ninguna respuesta.
 *
 * Errores: se traducen a español en ./verifacti-mapeo.ts.
 */

const URL_BASE = "https://api.verifacti.com";
const TIEMPO_MAXIMO_MS = 20_000;

export interface RespuestaAltaVerifacti {
  uuid: string;
  estado: string;
  url: string | null;
  qr: string | null;
  huella: string | null;
}

export interface RespuestaAnulacionVerifacti {
  uuid: string;
  estado: string;
  huella: string | null;
}

export interface EstadoRegistroVerifacti {
  estado: string;
  operacion: string | null;
  url: string | null;
  codigo_error: string | null;
  mensaje_error: string | null;
  estado_registro_duplicado: string | null;
}

export type ResultadoLlamada<T> =
  | { ok: true; datos: T; repetida: boolean; raw: unknown }
  | {
      ok: false;
      status: number;
      /** true si NO sabemos si Verifacti llegó a procesar la petición. */
      incierto: boolean;
      codigo: string | null;
      mensaje: string;
      raw: unknown;
    };

export class VerifactiClient implements ExternalInvoicingClient {
  readonly providerId = "verifacti" as const;

  private async llamar<T>(
    apiKey: string,
    metodo: "GET" | "POST",
    ruta: string,
    cuerpo?: unknown,
    idempotencyKey?: string,
  ): Promise<ResultadoLlamada<T>> {
    const headers: Record<string, string> = {
      accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    if (cuerpo !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    let res: Response;
    try {
      res = await fetch(`${URL_BASE}${ruta}`, {
        method: metodo,
        headers,
        body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        cache: "no-store",
      });
    } catch (e) {
      return {
        ok: false,
        status: 0,
        incierto: true,
        codigo: "RED",
        mensaje:
          "No se pudo contactar con Verifacti (" +
          (e instanceof Error ? e.message : String(e)) +
          "). Puede que la factura llegara: consulta el estado antes de reintentar.",
        raw: null,
      };
    }
    const raw = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      const r = (raw ?? {}) as { codigo?: string };
      return {
        ok: false,
        status: res.status,
        // 409 = la primera petición con esa clave sigue en curso.
        incierto: res.status === 409,
        codigo: r.codigo ?? `HTTP_${res.status}`,
        mensaje: mensajeErrorVerifacti(res.status, raw),
        raw,
      };
    }
    return {
      ok: true,
      datos: (raw ?? {}) as T,
      repetida: res.headers.get("Idempotent-Replayed") === "true",
      raw,
    };
  }

  async testConnection(creds: ProviderCredentials): Promise<TestConnectionResult> {
    const r = await this.llamar<{ estado?: string; nif?: string; entorno?: string }>(
      creds.api_key,
      "GET",
      "/verifactu/health",
    );
    if (!r.ok) return { ok: false, message: r.mensaje };
    const entorno = r.datos.entorno ?? "";
    return {
      ok: true,
      message: `Conexión correcta con Verifacti · NIF ${r.datos.nif ?? "?"} · entorno ${entorno === "test" ? "de pruebas" : entorno || "?"}.`,
      account_info: {
        nif: r.datos.nif ?? "",
        entorno,
        estado: r.datos.estado ?? "",
      },
    };
  }

  crear(apiKey: string, cuerpo: CuerpoAltaVerifacti, idempotencyKey: string) {
    return this.llamar<RespuestaAltaVerifacti>(
      apiKey,
      "POST",
      "/verifactu/create",
      cuerpo,
      idempotencyKey,
    );
  }

  anular(apiKey: string, cuerpo: CuerpoAnulacionVerifacti, idempotencyKey: string) {
    return this.llamar<RespuestaAnulacionVerifacti>(
      apiKey,
      "POST",
      "/verifactu/cancel",
      cuerpo,
      idempotencyKey,
    );
  }

  estadoRegistro(apiKey: string, uuid: string) {
    return this.llamar<EstadoRegistroVerifacti>(
      apiKey,
      "GET",
      `/verifactu/status?uuid=${encodeURIComponent(uuid)}`,
    );
  }

  /**
   * La interfaz genérica no lleva los datos que exige VeriFactu (desglose,
   * idempotencia, fecha de hoy…). Las facturas a Verifacti van SIEMPRE por
   * ./verifacti-envio.ts; este método no envía nada.
   */
  async pushInvoice(
    _creds: ProviderCredentials,
    _input: PushInvoiceInput,
  ): Promise<PushInvoiceResult> {
    return {
      ok: false,
      error_code: "USO_INTERNO",
      error_message: "Las facturas a Verifacti se registran con registrarAltaVerifacti().",
    };
  }
}
