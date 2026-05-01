import { notFound } from "next/navigation";
import { getCompany } from "@/modules/superadmin/companies/actions";
import { createClient } from "@/shared/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { CompanyEditForm } from "@/modules/superadmin/companies/edit-form";
import { CompanyModulesPanel } from "@/modules/superadmin/companies/modules-panel";

interface PageProps {
  params: Promise<{ id: string }>;
}

const statusLabel = {
  trial: "Prueba",
  active: "Activa",
  suspended: "Suspendida",
  cancelled: "Cancelada",
} as const;

const statusVariant = {
  trial: "warning",
  active: "success",
  suspended: "destructive",
  cancelled: "secondary",
} as const;

export default async function EmpresaDetallePage({ params }: PageProps) {
  const { id } = await params;
  let company;
  try {
    company = await getCompany(id);
  } catch {
    notFound();
  }

  const supabase = await createClient();
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

  const status = company.status as keyof typeof statusLabel;
  const activeMap = new Map(companyModules.map((m) => [m.module_key, m.is_active]));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{company.name}</h1>
            <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">slug: {company.slug}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Datos y límites</CardTitle>
          </CardHeader>
          <CardContent>
            <CompanyEditForm company={company} />
          </CardContent>
        </Card>

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
      </div>

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
