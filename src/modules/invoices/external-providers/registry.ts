import type { ProviderId, ProviderMeta, ExternalInvoicingClient } from "./types";

/**
 * Registro central de proveedores soportados (investigación 2026-05-30).
 *
 * Conclusión de la investigación (project_facturacion_integrations.md):
 *  · **Verifacti** y **Invopop** son los únicos diseñados como "tubería API"
 *    multi-tenant para CRMs/ISVs — caso EXACTO de Hidromanager.
 *  · Holded / Quipu / Odoo son útiles solo si la empresa YA usa esa plataforma
 *    (requieren cuenta de pago suya, API key con acceso total).
 *  · Factura.com, Anfix, Sage, Factusol → descartados (sin API útil para España,
 *    o sin API pública multi-tenant).
 */
export const PROVIDERS: ProviderMeta[] = [
  {
    id: "none",
    name: "Sin proveedor externo",
    tagline: "Facturación interna del CRM (modo simple o Verifactu in-house)",
    docs_url: "",
    has_sandbox: false,
    status: "ready",
  },
  {
    id: "verifacti",
    name: "Verifacti",
    tagline:
      "Pasarela Verifactu pura: firma XAdES + envío AEAT por API. Multi-tenant nativo, ~2,90 €/NIF/mes",
    docs_url: "https://www.verifacti.com/en/docs",
    has_sandbox: true,
    status: "ready",
    notes:
      "Ganador #1 según investigación. Una API key del CRM, NIFs ilimitados en sandbox, prod facturable por NIF. Encaja directo con el modo verifactu.",
  },
  {
    id: "invopop",
    name: "Invopop",
    tagline:
      "API de cumplimiento (Verifactu + SII + Facturae) con modo «emisión en nombre de otros»",
    docs_url: "https://www.invopop.com/coverage/verifactu-api",
    has_sandbox: true,
    status: "skeleton",
    notes:
      "Plan B sólido. Misma filosofía API-first multi-tenant. Precio no público (pedir).",
  },
  {
    id: "holded",
    name: "Holded",
    tagline:
      "ERP completo con API REST (~305 endpoints). Solo si la empresa YA usa Holded",
    docs_url: "https://developers.holded.com",
    has_sandbox: false,
    status: "skeleton",
    notes:
      "Una API key del workspace de la empresa cliente. Verifactu en adaptación según calendario AEAT. No usar como motor genérico — solo cuando el cliente del CRM ya tiene cuenta Holded.",
  },
  {
    id: "quipu",
    name: "Quipu",
    tagline:
      "SaaS facturación + contabilidad. Solo si la empresa YA usa Quipu (planes desde ~30 €/mes)",
    docs_url: "https://quipuapp.github.io/api-v1-docs/",
    has_sandbox: false,
    status: "planned",
    notes:
      "API requiere plan Solution o Premium. Multi-tenant solo si cada empresa pasa su API key. Verifactu producción real desde abr-2026.",
  },
  {
    id: "odoo",
    name: "Odoo (self-host)",
    tagline:
      "ERP open-source con módulo OCA l10n_es_edi_verifactu. Solo si la empresa tiene su propio Odoo",
    docs_url:
      "https://www.odoo.com/documentation/master/developer/api/external_api.html",
    has_sandbox: false,
    status: "planned",
    notes:
      "XML-RPC, requiere URL+DB+user por empresa. Solo tiene sentido si el cliente del CRM ya gestiona su Odoo.",
  },
];

export function findProvider(id: ProviderId): ProviderMeta | null {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/**
 * Devuelve los proveedores VISIBLES en el selector (no 'planned', no
 * 'incompatible' — esos quedan ocultos hasta tener integración real).
 */
export function selectableProviders(): ProviderMeta[] {
  return PROVIDERS.filter((p) => p.status === "ready" || p.status === "skeleton");
}

/**
 * Devuelve el cliente concreto para un proveedor. Carga dinámica para no
 * inflar el bundle del panel de configuración. Lanza si no hay cliente.
 */
export async function getProviderClient(
  id: ProviderId,
): Promise<ExternalInvoicingClient> {
  switch (id) {
    case "verifacti": {
      const { VerifactiClient } = await import("./verifacti");
      return new VerifactiClient();
    }
    case "invopop": {
      const { InvopopClient } = await import("./invopop");
      return new InvopopClient();
    }
    case "holded": {
      const { HoldedClient } = await import("./holded");
      return new HoldedClient();
    }
    default:
      throw new Error(
        `Proveedor "${id}" no tiene cliente implementado. Lista en registry.ts.`,
      );
  }
}
