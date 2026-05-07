import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

export const dynamic = "force-dynamic";

export default async function ConfigClientesPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="text-sm text-muted-foreground">
          Configuración del módulo de clientes.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reglas de duplicado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            El sistema avisa de posibles duplicados al crear/editar leads y
            clientes mirando: <strong>DNI/CIF</strong> (exacto), <strong>email</strong> (exacto en
            minúsculas), <strong>teléfono principal</strong> (normalizado +34).
          </p>
          <p>
            Los leads ya convertidos NO aparecen como duplicados (decisión
            2026-05-07).
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Campos personalizados</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Próximamente: añadir campos custom (texto, número, lista) a la ficha
          de cliente.
        </CardContent>
      </Card>
    </div>
  );
}
