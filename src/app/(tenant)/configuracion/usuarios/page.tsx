import { listTenantUsers } from "@/modules/tenant/users/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { InviteUserForm } from "@/modules/tenant/users/invite-form";
import { UserRowActions } from "@/modules/tenant/users/row-actions";
import { ROLE_KEYS } from "@/modules/tenant/users/schemas";
import { UserAvatar } from "@/shared/components/user-avatar";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<string, string> = {
  company_admin: "Admin",
  technical_director: "Director técnico",
  commercial_director: "Director comercial",
  telemarketing_director: "Director TMK",
  installer: "Instalador",
  sales_rep: "Comercial",
  telemarketer: "Teleoperador",
};

const STATUS_LABEL: Record<string, string> = {
  invited: "Invitado",
  active: "Activo",
  inactive: "Inactivo",
  suspended: "Suspendido",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> =
  {
    invited: "warning",
    active: "success",
    inactive: "secondary",
    suspended: "destructive",
  };

export default async function UsuariosPage() {
  const users = await listTenantUsers();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Usuarios</h1>
        <p className="text-sm text-muted-foreground">
          {users.length} usuarios en tu empresa
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Equipo</CardTitle>
          </CardHeader>
          <CardContent>
            {users.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no hay usuarios. Invita al primero desde el panel de la derecha.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-12 py-2"></th>
                    <th className="py-2 text-left">Nombre</th>
                    <th className="py-2 text-left">Email</th>
                    <th className="py-2 text-left">Roles</th>
                    <th className="py-2 text-left">Estado</th>
                    <th className="py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {users.map((u) => (
                    <tr key={u.user_id}>
                      <td className="py-3">
                        <UserAvatar userId={u.user_id} name={u.full_name} size="md" />
                      </td>
                      <td className="py-3">
                        <div className="font-medium">{u.full_name}</div>
                        {u.job_title && (
                          <div className="text-xs text-muted-foreground">{u.job_title}</div>
                        )}
                      </td>
                      <td className="py-3 text-muted-foreground">{u.email ?? "—"}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <Badge key={r} variant="outline">
                              {ROLE_LABEL[r] ?? r}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-3">
                        <Badge variant={STATUS_VARIANT[u.status]}>{STATUS_LABEL[u.status]}</Badge>
                      </td>
                      <td className="py-3">
                        <UserRowActions
                          userId={u.user_id}
                          currentRoles={u.roles}
                          status={u.status}
                          fullName={u.full_name}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invitar usuario</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteUserForm
              roleOptions={ROLE_KEYS.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }))}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
