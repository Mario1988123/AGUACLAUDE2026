import { notFound } from "next/navigation";
import { getCompany, getCompanyAdmin } from "@/modules/superadmin/companies/actions";
import { createClient } from "@/shared/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { CompanyEditForm } from "@/modules/superadmin/companies/edit-form";
import { CompanyModulesPanel } from "@/modules/superadmin/companies/modules-panel";
import { CompanyAdminPanel } from "@/modules/superadmin/companies/admin-panel";

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
                    <td className="py-2">{u.status}</td>
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
