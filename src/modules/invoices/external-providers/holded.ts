import type {
  ExternalInvoicingClient,
  ProviderCredentials,
  PushInvoiceInput,
  PushInvoiceResult,
  TestConnectionResult,
} from "./types";

/**
 * Cliente Holded (https://developers.holded.com).
 *
 * AUTH: API key estática, header `key: <API_KEY>`. Una API key por workspace
 * Holded. Multi-tenant friendly: cada empresa que usa nuestro CRM pega su
 * API key personal.
 *
 * Endpoint base producción: https://api.holded.com/api/invoicing/v1
 * Endpoint sandbox: NO existe sandbox público (la empresa puede usar un
 * workspace de prueba propio).
 *
 * Para crear una factura: POST /documents/invoice con el JSON del documento.
 * Verifactu: Holded lo gestiona en su lado si la empresa tiene activado
 * "Verifactu" en su cuenta — no es algo que controlemos por API.
 */
export class HoldedClient implements ExternalInvoicingClient {
  readonly providerId = "holded" as const;
  private readonly BASE_URL = "https://api.holded.com/api/invoicing/v1";

  async testConnection(creds: ProviderCredentials): Promise<TestConnectionResult> {
    try {
      // GET /contacts (cualquier endpoint que valide la API key) con limit=1.
      const res = await fetch(`${this.BASE_URL}/contacts?limit=1`, {
        method: "GET",
        headers: {
          accept: "application/json",
          key: creds.api_key,
        },
      });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: "API key no válida o sin permisos." };
      }
      if (!res.ok) {
        return {
          ok: false,
          message: `Holded devolvió ${res.status}. Revisa la API key.`,
        };
      }
      return {
        ok: true,
        message: "Conexión OK con Holded.",
      };
    } catch (e) {
      return {
        ok: false,
        message:
          "No se pudo contactar con Holded: " +
          (e instanceof Error ? e.message : String(e)),
      };
    }
  }

  async pushInvoice(
    creds: ProviderCredentials,
    input: PushInvoiceInput,
  ): Promise<PushInvoiceResult> {
    try {
      // Mapeo nuestro modelo → JSON de Holded. Estructura aproximada (la doc
      // exacta de Holded usa items[], contactName, customFields, etc.):
      const payload = {
        contactCode: input.customer.tax_id ?? undefined,
        contactName: input.customer.name,
        contactEmail: input.customer.email ?? undefined,
        desc: input.notes ?? undefined,
        date: Math.floor(new Date(input.issued_at).getTime() / 1000),
        dueDate: input.due_at
          ? Math.floor(new Date(input.due_at).getTime() / 1000)
          : undefined,
        notes: input.notes ?? undefined,
        items: input.lines.map((l) => ({
          name: l.description,
          units: l.quantity,
          // Holded espera precio en euros (no céntimos).
          price: l.unit_price_cents / 100,
          tax: l.tax_rate,
        })),
      };

      const res = await fetch(`${this.BASE_URL}/documents/invoice`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          key: creds.api_key,
        },
        body: JSON.stringify(payload),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error_code: `HTTP_${res.status}`,
          error_message:
            (raw as { error?: string; message?: string })?.error ??
            (raw as { message?: string })?.message ??
            `Holded devolvió ${res.status}`,
          raw_response: raw,
        };
      }
      const id = (raw as { id?: string }).id;
      return {
        ok: true,
        external_id: id,
        external_url: id ? `https://app.holded.com/invoices/${id}` : undefined,
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
