import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { getFiscalSettings } from "@/modules/config/fiscal/actions";
import { FiscalSettingsForm } from "@/modules/config/fiscal/fiscal-form";

export const dynamic = "force-dynamic";

export default async function ConfigFiscalPage() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin")) {
    redirect("/configuracion" as never);
  }
  const initial = await getFiscalSettings();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Configuración · Datos fiscales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Estos datos se imprimen como emisor en facturas, propuestas y contratos generados.
        </p>
      </div>
      <FiscalSettingsForm initial={initial} />
    </div>
  );
}
