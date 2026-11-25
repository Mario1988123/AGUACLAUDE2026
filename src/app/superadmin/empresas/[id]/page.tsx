import { notFound } from "next/navigation";
import {
  getCompany,
  getCompanyAdmin,
  getCompaniesMetrics,
} from "@/modules/superadmin/companies/actions";
import { createClient } from "@/shared/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { StatusPill } from "@/shared/components/status-pill";
import { BackButton } from "@/shared/components/back-button";
import { ShieldCheck } from "lucide-react";
import { estadoEmpresa, esEmpresaProtegida } from "@/shared/lib/empresas/estado";
import { ZonaPeligrosaEmpresa } from "@/modules/superadmin/companies/ciclo-vida-ui";
import { CompanyEditForm } from "@/modules/superadmin/companies/edit-form";
import { CompanyModulesPanel } from "@/modules/superadmin/companies/modules-panel";
import { CompanyAdminPanel } from "@/modules/superadmin/companies/admin-panel";
import { CompanyGmapsPanel } from "@/modules/superadmin/companies/gmaps-panel";
import { CompanyEmailProviderPanel } from "@/modules/superadmin/companies/email-provider-panel";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const userStatusLabel: Record<string, string> = {
  active: "Activo",
  invited: "Invitado",
  suspended: "Suspendido",
  pending: "Pendiente",
};

export default async function EmpresaDetallePage({ params }: PageProps) {
  const { id } = await params;
  let company;
  try {
    company = await getCompany(id);
  } catch {
    notFound();
  }

  // Filtramos a campos serializables/ usados por el cliente
  const fiscal = (company.fiscal_data ?? {}) as Record<string, string | null>;
  const safeCompany = {
    id: company.id,
    name: company.name ?? "",
    slug: company.slug ?? "",
    max_users: company.max_users ?? 5,
    max_storage_mb: company.max_storage_mb ?? 1024,
    monthly_cost_cents: company.monthly_cost_cents ?? 0,
    billing_email: company.billing_email ?? null,
    primary_color: company.primary_color ?? "#2563eb",
    fiscal_legal_name: fiscal.legal_name ?? "",
    fiscal_tax_id: fiscal.tax_id ?? "",
    fiscal_address: fiscal.address ?? "",
  };
  const status = company.status ?? "trial";
  const protegida = esEmpresaProtegida(company.id, company.protegida);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // Datos Google Maps Tools (módulo gateado). Defensivo: si la migración
  // 20260524160000 no se ha aplicado todavía o PostgREST tiene schema
  // cache stale, el select cae a solo gmaps_mode (o nada).
  type GmapsRow = {
    gmaps_mode: "disabled" | "shared_key" | "own_key" | null;
    gmaps_monthly_cap_usd: number | null;
    gmaps_daily_cap_usd: number | null;
  };
  let gmaps: GmapsRow | null = null;
  try {
    const r = await supabase
      .from("companies")
      .select("gmaps_mode, gmaps_monthly_cap_usd, gmaps_daily_cap_usd")
      .eq("id", id)
      .maybeSingle();
    gmaps = (r.data ?? null) as GmapsRow | null;
  } catch {
    try {
      const r2 = await supabase
        .from("companies")
        .select("gmaps_mode")
        .eq("id", id)
        .maybeSingle();
      const row = (r2.data ?? null) as
        | { gmaps_mode: GmapsRow["gmaps_mode"] }
        | null;
      gmaps = row
        ? {
            gmaps_mode: row.gmaps_mode,
            gmaps_monthly_cap_usd: null,
            gmaps_daily_cap_usd: null,
          }
        : null;
    } catch {
      gmaps = null;
    }
  }
  // Proveedor de email (smtp|resend) + estado dominio Resend. Defensivo:
  // si la migración 20260620900000 no está aplicada, cae a 'smtp'.
  let emailProvider: "smtp" | "resend" = "smtp";
  let resendDomainVerified = false;
  try {
    const r = await supabase
      .from("companies")
      .select("email_provider")
      .eq("id", id)
      .maybeSingle();
    emailProvider =
      ((r.data as { email_provider?: string } | null)?.email_provider as
        | "smtp"
        | "resend") ?? "smtp";
  } catch {
    emailProvider = "smtp";
  }
  try {
    const r = await supabase
      .from("company_settings")
      .select("extra")
      .eq("company_id", id)
      .maybeSingle();
    const er = (r.data?.extra as { email_resend?: { status?: string } } | null)
      ?.email_resend;
    resendDomainVerified = er?.status === "verified";
  } catch {
    resendDomainVerified = false;
  }

  // Consumo mes actual (informativo)
  let gmapsMonthUsd = 0;
  if ((gmaps?.gmaps_mode ?? "disabled") !== "disabled") {
    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    ).toISOString();
    // Por tramos: un select plano se cortaba en 1000 filas.
    const { sumarGastoGoogleUsd } = await import("@/shared/lib/google-maps/gasto");
    gmapsMonthUsd = await sumarGastoGoogleUsd(supabase, id, monthStart);
  }

  const companyAdmin = await getCompanyAdmin(id);
  const metrica = (await getCompaniesMetrics([id]).catch(() => new Map())).get(id);
  const [modulesRes, companyModulesRes, usersRes, ajustesRes] = await Promise.all([
    supabase
      .from("modules_catalog")
      .select("key, label_es, description_es, is_core, is_parked, sort_order")
      .order("sort_order"),
    supabase.from("company_modules").select("module_key, is_active").eq("company_id", id),
    supabase
      .from("user_profiles")
      .select("user_id, full_name, status, created_at")
      .eq("company_id", id)
      .order("created_at"),
    // Datos que la propia empresa rellena en Configuración (solo lectura aquí).
    supabase
      .from("company_settings")
      .select(
        "contact_phone, contact_email, fiscal_legal_name, fiscal_tax_id, fiscal_street, fiscal_address, fiscal_postal_code, fiscal_city, fiscal_province",
      )
      .eq("company_id", id)
      .maybeSingle(),
  ]);
  const ajustes = (ajustesRes.data ?? null) as Record<string, string | null> | null;
  const datosEmpresa: Array<[string, string]> = ajustes
    ? (
        [
          ["Razón social", ajustes.fiscal_legal_name],
          ["CIF / NIF", ajustes.fiscal_tax_id],
          ["Teléfono", ajustes.contact_phone],
          ["Email", ajustes.contact_email],
          [
            "Dirección",
            [
              ajustes.fiscal_street ?? ajustes.fiscal_address,
              [ajustes.fiscal_postal_code, ajustes.fiscal_city].filter(Boolean).join(" "),
              ajustes.fiscal_province,
            ]
              .filter(Boolean)
              .join(", "),
          ],
        ] as Array<[string, string | null | undefined]>
      ).filter((x): x is [string, string] => Boolean(x[1]))
    : [];

  const modulesCatalog = (modulesRes.data ?? []) as {
    key: string;
    label_es: string;
    description_es: string | null;
    is_core: boolean;
    is_parked: boolean;
    sort_order: number;
  }[];
  const companyModules = (companyModulesRes.data ?? []) as {
    module_key: string;
    is_active: boolean;
  }[];
  const users = (usersRes.data ?? []) as {
    user_id: string;
    full_name: string;
    status: string;
    created_at: string;
  }[];

  const activeMap = new Map(companyModules.map((m) => [m.module_key, m.is_active]));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackButton href="/superadmin" label="Empresas" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words text-2xl font-bold">{safeCompany.name}</h1>
            <StatusPill label={estadoEmpresa(status).label} tone={estadoEmpresa(status).tono} />
            {protegida ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Protegida
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">slug: {safeCompany.slug}</p>
          {status === "cancelled" && company.cancelled_at ? (
            <p className="text-sm text-muted-foreground">
              De baja desde el {new Date(company.cancelled_at).toLocaleDateString("es-ES")}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Datos y límites</CardTitle>
          </CardHeader>
          <CardContent>
            <CompanyEditForm company={safeCompany} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Administrador de la empresa</CardTitle>
          </CardHeader>
          <CardContent>
            <CompanyAdminPanel companyId={id} admin={companyAdmin} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Módulos activos</CardTitle>
        </CardHeader>
        <CardContent>
          <CompanyModulesPanel
            companyId={id}
            modules={modulesCatalog}
            activeMap={Object.fromEntries(activeMap)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Google Maps Tools</CardTitle>
        </CardHeader>
        <CardContent>
          <CompanyGmapsPanel
            companyId={id}
            initial={{
              mode: (gmaps?.gmaps_mode ?? "disabled") as
                | "disabled"
                | "shared_key"
                | "own_key",
              monthly_cap_usd: Number(gmaps?.gmaps_monthly_cap_usd ?? 50),
              daily_cap_usd: Number(gmaps?.gmaps_daily_cap_usd ?? 10),
            }}
            current_month_usd={gmapsMonthUsd}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Proveedor de email</CardTitle>
        </CardHeader>
        <CardContent>
          <CompanyEmailProviderPanel
            companyId={id}
            initial={emailProvider}
            resendDomainVerified={resendDomainVerified}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuarios ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta empresa todavía no tiene usuarios. El admin de la empresa los creará desde el
              panel tenant.
            </p>
          ) : (
            <ul className="divide-y">
              {users.map((u) => (
                <li key={u.user_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{u.full_name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {userStatusLabel[u.status] ?? u.status} ·{" "}
                    {new Date(u.created_at).toLocaleDateString("es-ES")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos que ha puesto la empresa</CardTitle>
        </CardHeader>
        <CardContent>
          {datosEmpresa.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              La empresa aún no ha rellenado sus datos en Configuración.
            </p>
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {datosEmpresa.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Los edita la empresa en Configuración; son los que salen en sus facturas y documentos.
          </p>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Zona peligrosa</CardTitle>
        </CardHeader>
        <CardContent>
          <ZonaPeligrosaEmpresa
            companyId={id}
            nombre={safeCompany.name}
            status={status}
            protegida={protegida}
            recuento={{
              usuarios: metrica?.users_count ?? users.length,
              clientes: metrica?.customers_count ?? 0,
              contratos: metrica?.contracts_active_count ?? 0,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
