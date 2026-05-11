import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { getProposalsConfig } from "@/modules/config/proposals/actions";
import { ProposalsConfigForm } from "@/modules/config/proposals/form";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function ConfigPropuestasPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/dashboard");
  }
  const config = await getProposalsConfig();
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Propuestas</h1>
          <p className="text-sm text-muted-foreground">
            Configuración de propuestas comerciales.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validez por defecto</CardTitle>
        </CardHeader>
        <CardContent>
          <ProposalsConfigForm initial={config} />
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
