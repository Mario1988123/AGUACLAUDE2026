import type {
  ExternalInvoicingClient,
  ProviderCredentials,
  PushInvoiceInput,
  PushInvoiceResult,
  TestConnectionResult,
} from "./types";

/**
 * Cliente Invopop (https://www.invopop.com).
 *
 * Modelo "invoicing on behalf of others" — pensado para marketplaces/CRMs
 * que emiten facturas en nombre de sus clientes. Multi-tenant explícito.
 *
 * Documentación pública limitada: API REST con API key, base
 * https://api.invopop.com. Soporta Verifactu + SII + Facturae.
 *
 * **Estado**: skeleton — verifica conexión y empuja payload básico. Los
 * detalles exactos del schema GOBL/Invopop necesitan iteración contra su
 * sandbox antes de marcar como 'ready'.
 */
export class InvopopClient implements ExternalInvoicingClient {
  readonly providerId = "invopop" as const;

  private baseUrl(creds: ProviderCredentials): string {
    return (
      creds.extra?.api_base_url?.replace(/\/+$/, "") ?? "https://api.invopop.com"
    );
  }

  async testConnection(creds: ProviderCredentials): Promise<TestConnectionResult> {
    try {
      const res = await fetch(`${this.baseUrl(creds)}/access/v1/me`, {
        method: "GET",
        headers: {
          accept: "application/json",
          Authorization: `Bearer ${creds.api_key}`,
        },
      });
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          message: "API key no aceptada por Invopop. Genera otra en su panel.",
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          message: `Invopop devolvió ${res.status}.`,
        };
      }
      const j = (await res.json().catch(() => ({}))) as {
        email?: string;
        name?: string;
      };
      return {
        ok: true,
        message: "Conexión OK con Invopop.",
        account_info: {
          ...(j.email ? { email: j.email } : {}),
          ...(j.name ? { name: j.name } : {}),
        },
      };
    } catch (e) {
      return {
        ok: false,
        message:
          "No se pudo contactar con Invopop: " +
          (e instanceof Error ? e.message : String(e)),
      };
    }
  }

  async pushInvoice(
    creds: ProviderCredentials,
    input: PushInvoiceInput,
  ): Promise<PushInvoiceResult> {
    try {
      // Invopop usa el formato GOBL (open schema). Estructura aproximada:
      //   { type: "invoice", supplier: {...}, customer: {...}, lines: [...] }
      // Aquí mandamos lo mínimo coherente con su esquema; el resto se
      // afina contra el sandbox antes de marcar 'ready'.
      const payload = {
        type: "invoice",
        series: input.full_reference?.split("-")[0] ?? "",
        code:
          input.reference_code ?? input.full_reference ?? `INV-${Date.now()}`,
        issue_date: input.issued_at.slice(0, 10),
        due_date: input.due_at?.slice(0, 10) ?? null,
        customer: {
          name: input.customer.name,
          tax_id: input.customer.tax_id ?? undefined,
          email: input.customer.email ?? undefined,
          address: {
            street: input.customer.address,
            code: input.customer.postal_code,
            locality: input.customer.city,
            region: input.customer.province,
            country: input.customer.country ?? "ES",
          },
        },
        lines: input.lines.map((l) => ({
          item: { name: l.description },
          quantity: l.quantity,
          unit_price: (l.unit_price_cents / 100).toFixed(2),
          tax_rate: l.tax_rate,
        })),
        totals: {
          subtotal: (input.subtotal_cents / 100).toFixed(2),
          tax: (input.tax_total_cents / 100).toFixed(2),
          total: (input.total_cents / 100).toFixed(2),
        },
      };

      const res = await fetch(`${this.baseUrl(creds)}/jobs/v1/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          Authorization: `Bearer ${creds.api_key}`,
        },
        body: JSON.stringify({
          intent: "verifactu.submit",
          envelope: { doc: payload },
        }),
      });
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          error_code: `HTTP_${res.status}`,
          error_message:
            (raw as { message?: string; error?: string })?.message ??
            (raw as { error?: string })?.error ??
            `Invopop devolvió ${res.status}`,
          raw_response: raw,
        };
      }
      const r = raw as { id?: string; permalink?: string };
      return {
        ok: true,
        external_id: r.id,
        external_url: r.permalink,
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
