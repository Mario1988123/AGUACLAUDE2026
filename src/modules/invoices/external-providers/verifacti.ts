import type {
  ExternalInvoicingClient,
  ProviderCredentials,
  PushInvoiceInput,
  PushInvoiceResult,
  TestConnectionResult,
} from "./types";

/**
 * Cliente Verifacti (https://www.verifacti.com).
 *
 * AUTH: API key del proveedor en header `Authorization: Bearer <key>` (estándar
 * del sector; se ajusta vía panel admin si Verifacti pidiera otro header).
 *
 * MODELO MULTI-TENANT: Verifacti factura por NIF activo. Cada empresa cliente
 * del CRM introduce el NIF de su empresa al activar Verifactu interno (ya está
 * en company_settings.fiscal_tax_id). En sandbox los NIFs son ilimitados.
 *
 * ENDPOINTS conocidos (docs públicas de Verifacti son escuetas; URL y header
 * exactos pueden ajustarse vía credentials.extra.api_base_url y
 * .auth_header_name si fuera necesario):
 *   POST /verifactu/create        — crear y enviar 1 factura
 *   POST /verifactu/create_bulk   — hasta 50 facturas
 *   GET  /verifactu/health        — comprobar conexión
 */
export class VerifactiClient implements ExternalInvoicingClient {
  readonly providerId = "verifacti" as const;

  private baseUrl(creds: ProviderCredentials): string {
    const extra = creds.extra ?? {};
    if (extra.api_base_url) return extra.api_base_url.replace(/\/+$/, "");
    // El propio Verifacti no publica todavía URLs separadas prod/sandbox en
    // su doc abierta — usan el mismo dominio y un flag de cuenta. Si esto
    // cambia, el admin pega la URL correcta en "extras" del panel.
    return creds.environment === "production"
      ? "https://api.verifacti.com"
      : "https://api.verifacti.com";
  }

  private authHeaders(creds: ProviderCredentials): Record<string, string> {
    const headerName = creds.extra?.auth_header_name ?? "Authorization";
    const headerValue = creds.extra?.auth_header_value_prefix
      ? `${creds.extra.auth_header_value_prefix}${creds.api_key}`
      : `Bearer ${creds.api_key}`;
    return { [headerName]: headerValue };
  }

  async testConnection(creds: ProviderCredentials): Promise<TestConnectionResult> {
    try {
      const res = await fetch(`${this.baseUrl(creds)}/verifactu/health`, {
        method: "GET",
        headers: {
          accept: "application/json",
          ...this.authHeaders(creds),
        },
      });
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message:
            "API key no aceptada por Verifacti. Comprueba la clave en tu panel.",
        };
      }
      if (res.status === 404) {
        return {
          ok: false,
          message:
            "Endpoint /verifactu/health no encontrado. Si Verifacti cambió la URL base, configúrala en «extras» del panel (api_base_url).",
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          message: `Verifacti devolvió ${res.status}. Revisa el panel del proveedor.`,
        };
      }
      const env =
        creds.environment === "production" ? "Producción" : "Sandbox";
      return {
        ok: true,
        message: `Conexión OK con Verifacti (${env}).`,
        account_info: { environment: env },
      };
    } catch (e) {
      return {
        ok: false,
        message:
          "No se pudo contactar con Verifacti: " +
          (e instanceof Error ? e.message : String(e)),
      };
    }
  }

  async pushInvoice(
    creds: ProviderCredentials,
    input: PushInvoiceInput,
  ): Promise<PushInvoiceResult> {
    try {
      // Mapeo nuestro modelo → payload Verifactu (campos documentados):
      //   serie, numero, fecha_expedicion, fecha_operacion, tipo_factura,
      //   descripcion, lineas[], importe_total, nif (destinatario), nombre.
      // Verifacti espera importes con coma o punto en EUROS (no céntimos).
      const ref = input.reference_code ?? input.full_reference ?? "";
      // Sacar serie y número del reference_code "SERIE-YYYY-NNNN" o
      // "PREFIX-SERIE-YYYY-NNNN" — caemos al full_reference legacy.
      const refMatch = ref.match(/^(?:.*?)([A-Z0-9]+)-(\d{4})-(\d+)$/i);
      const serie = refMatch?.[1] ?? "";
      const numero = refMatch?.[3] ?? "1";

      const fechaExp = input.issued_at.slice(0, 10);

      const lineas = input.lines.map((l) => ({
        descripcion: l.description,
        cantidad: l.quantity,
        // Verifacti pide importes en euros con punto decimal.
        precio_unitario: (l.unit_price_cents / 100).toFixed(2),
        tipo_iva: String(l.tax_rate),
      }));

      const payload: Record<string, unknown> = {
        serie,
        numero,
        fecha_expedicion: fechaExp,
        tipo_factura: "F1",
        descripcion: input.notes ?? `Factura ${ref}`,
        lineas,
        importe_total: (input.total_cents / 100).toFixed(2),
        nif: input.customer.tax_id ?? undefined,
        nombre: input.customer.name,
      };

      const res = await fetch(`${this.baseUrl(creds)}/verifactu/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          ...this.authHeaders(creds),
        },
        body: JSON.stringify(payload),
      });
      const raw = await res.json().catch(() => ({}));

      if (!res.ok) {
        return {
          ok: false,
          error_code: `HTTP_${res.status}`,
          error_message:
            (raw as { error?: string; message?: string; detail?: string })
              ?.detail ??
            (raw as { error?: string })?.error ??
            (raw as { message?: string })?.message ??
            `Verifacti devolvió ${res.status}`,
          raw_response: raw,
        };
      }

      // Verifacti suele devolver { id, csv_aeat, status, hash, ... } — recogemos
      // los campos comunes, tolerando que el shape exacto pueda variar.
      const r = raw as {
        id?: string | number;
        csv_aeat?: string;
        csv?: string;
        url?: string;
        permalink?: string;
      };
      return {
        ok: true,
        external_id: r.id != null ? String(r.id) : undefined,
        external_url: r.url ?? r.permalink,
        aeat_csv: r.csv_aeat ?? r.csv,
        raw_response: raw,
      };
    } catch (e) {
      return {
        ok: false,
        error_code: "NETWORK",
        error_message: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
