/**
 * Tipos comunes para integraciones con SaaS externos de facturación.
 *
 * Cada proveedor (Verifacta, Holded, Factura.com, Quipu, Odoo, etc.) implementa
 * la interfaz ExternalInvoicingClient. Una empresa elige UN proveedor en
 * /configuracion/facturacion. Al emitir una factura, en lugar (o además) de
 * usar el flujo interno, la empujamos al proveedor por API y él se encarga
 * de la firma XAdES + envío a AEAT.
 */

/** Identificador del proveedor en company_settings.external_invoicing_provider.
 *  Lista cerrada según investigación 2026-05-30 (project_facturacion_integrations.md). */
export type ProviderId =
  | "none"
  | "verifacti"
  | "invopop"
  | "holded"
  | "quipu"
  | "odoo";

/** Metadata mostrada en el panel de configuración. */
export interface ProviderMeta {
  id: ProviderId;
  name: string;
  /** Una línea descriptiva para el selector. */
  tagline: string;
  /** URL al panel del proveedor donde el admin obtiene la API key. */
  docs_url: string;
  /** Si el proveedor soporta entorno sandbox separado. */
  has_sandbox: boolean;
  /** Estado de la integración en NUESTRO código:
   *   - "ready": funciona end-to-end (push real al proveedor).
   *   - "skeleton": estructura preparada pero falta lógica concreta.
   *   - "planned": investigación hecha, implementación pendiente.
   *   - "incompatible": investigamos y NO se puede integrar (sin API, etc.).
   */
  status: "ready" | "skeleton" | "planned" | "incompatible";
  /** Notas para el admin (motivo del status, requisitos, etc.). */
  notes?: string;
}

/** Resultado de testear la conexión con las credenciales actuales. */
export interface TestConnectionResult {
  ok: boolean;
  message: string;
  /** Si el proveedor devuelve datos identificativos de la cuenta (email, plan). */
  account_info?: Record<string, string>;
}

/** Datos mínimos para empujar una factura. La forma exacta la mapea cada cliente. */
export interface PushInvoiceInput {
  invoice_id: string;
  company_id: string;
  reference_code: string | null;
  full_reference: string | null;
  issued_at: string;
  due_at: string | null;
  customer: {
    name: string;
    tax_id: string | null;
    email: string | null;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    province: string | null;
    country: string;
  };
  lines: Array<{
    description: string;
    quantity: number;
    unit_price_cents: number;
    tax_rate: number;
  }>;
  subtotal_cents: number;
  tax_total_cents: number;
  total_cents: number;
  notes: string | null;
}

/** Resultado de empujar una factura. */
export interface PushInvoiceResult {
  ok: boolean;
  /** ID asignado por el proveedor (para tracking + reintentos). */
  external_id?: string;
  /** URL al recurso en el panel del proveedor (para que admin pueda abrirlo). */
  external_url?: string;
  /** Si el proveedor ya nos confirma que envió a AEAT y devuelve CSV. */
  aeat_csv?: string;
  error_code?: string;
  error_message?: string;
  raw_response?: unknown;
}

/** Credenciales descifradas para el cliente. */
export interface ProviderCredentials {
  api_key: string;
  environment: "sandbox" | "production";
  /** Extras provider-specific (Odoo: { url, db, user }, etc.). */
  extra?: Record<string, string>;
}

/** Interfaz que cumple cada cliente concreto. */
export interface ExternalInvoicingClient {
  /** ID del proveedor (debe coincidir con el ProviderId del registro). */
  readonly providerId: ProviderId;

  /** Comprueba que las credenciales valen. Llamada por el botón "Probar conexión". */
  testConnection(creds: ProviderCredentials): Promise<TestConnectionResult>;

  /** Empuja una factura emitida a la API del proveedor. */
  pushInvoice(
    creds: ProviderCredentials,
    input: PushInvoiceInput,
  ): Promise<PushInvoiceResult>;
}
