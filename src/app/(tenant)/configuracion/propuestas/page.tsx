import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

export const dynamic = "force-dynamic";

export default async function ConfigPropuestasPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Propuestas</h1>
        <p className="text-sm text-muted-foreground">
          Configuración de propuestas comerciales.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validez por defecto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Cuando un comercial crea una propuesta sin fecha de validez, se
            aplica el valor por defecto de la empresa. Configura aquí la
            duración deseada (próximamente editable).
          </p>
          <p className="rounded-lg border bg-muted/30 p-3 text-xs">
            <strong>Por defecto:</strong> 30 días desde la creación.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Aprobación de descuentos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Si un comercial aplica precio por debajo del mínimo autorizado del
            producto, la propuesta queda en estado{" "}
            <strong>pending_approval</strong> y notifica a admin/director
            comercial.
          </p>
          <p className="text-xs">
            El threshold se gestiona producto a producto en{" "}
            <code>min_authorized_cents</code> y <code>absolute_min_cents</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
