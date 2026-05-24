import { notFound } from "next/navigation";
import { getCompany, getCompanyAdmin } from "@/modules/superadmin/companies/actions";
import { createClient } from "@/shared/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { CompanyEditForm } from "@/modules/superadmin/companies/edit-form";
import { CompanyModulesPanel } from "@/modules/superadmin/companies/modules-panel";
import { CompanyAdminPanel } from "@/modules/superadmin/companies/admin-panel";
import { CompanyGmapsPanel } from "@/modules/superadmin/companies/gmaps-panel";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

const statusLabel: Record<string, string> = {
  trial: "Prueba",
  active: "Activa",
  suspended: "Suspendida",
  cancelled: "Cancelada",
};

const statusVariant: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  trial: "warning",
  active: "success",
  suspended: "destructive",
  cancelled: "secondary",
};

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
  const safeCompany = {
    id: company.id,
    name: company.name ?? "",
    slug: company.slug ?? "",
    status: company.status ?? "trial",
    max_users: company.max_users ?? 5,
    max_storage_mb: company.max_storage_mb ?? 1024,
    monthly_cost_cents: company.monthly_cost_cents ?? 0,
    billing_email: company.billing_email ?? null,
    primary_color: company.primary_color ?? "#2563eb",
  };

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
  // Consumo mes actual (informativo)
  let gmapsMonthUsd = 0;
  if ((gmaps?.gmaps_mode ?? "disabled") !== "disabled") {
    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    ).toISOString();
    const { data: usageRows } = await supabase
      .from("google_api_usage")
      .select("cost_micro_usd")
      .eq("company_id", id)
      .eq("success", true)
      .gte("called_at", monthStart);
    const micro = ((usageRows ?? []) as Array<{ cost_micro_usd: number }>).reduce(
      (s, r) => s + Number(r.cost_micro_usd),
      0,
    );
    gmapsMonthUsd = micro / 1_000_000;
  }

  const companyAdmin = await getCompanyAdmin(id);
  const [modulesRes, companyModulesRes, usersRes] = await Promise.all([
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
  ]);

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

  const status = safeCompany.status;
  const activeMap = new Map(companyModules.map((m) => [m.module_key, m.is_active]));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{safeCompany.name}</h1>
            <Badge variant={statusVariant[status] ?? "secondary"}>
              {statusLabel[status] ?? status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">slug: {safeCompany.slug}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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
          <CardTitle>Usuarios ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta empresa todavía no tiene usuarios. El admin de la empresa los creará desde el
              panel tenant.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Nombre</th>
                  <th className="py-2 text-left">Estado</th>
                  <th className="py-2 text-left">Alta</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map((u) => (
                  <tr key={u.user_id}>
                    <td className="py-2">{u.full_name}</td>
                    <td className="py-2">{userStatusLabel[u.status] ?? u.status}</td>
                    <td className="py-2">{new Date(u.created_at).toLocaleDateString("es-ES")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
