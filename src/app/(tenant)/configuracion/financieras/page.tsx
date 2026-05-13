import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { listFinanciers } from "@/modules/financiers/actions";
import { FinanciersManager } from "@/modules/financiers/manager";
import { BackButton } from "@/shared/components/back-button";

export const dynamic = "force-dynamic";

export default async function ConfigFinancierasPage() {
  const session = await requireSession();
  if (
    !session.is_superadmin &&
    !session.roles.includes("company_admin") &&
    !session.roles.includes("commercial_director") &&
    !session.roles.includes("technical_director")
  ) {
    redirect("/configuracion" as never);
  }
  const items = await listFinanciers().catch(() => []);
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Financieras</h1>
          <p className="text-sm text-muted-foreground">
            Renting y financiación. Cada financiera tiene una tabla de
            coeficientes por plazo que se usa al hacer propuestas para
            calcular cuotas y comisiones.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>
      <FinanciersManager initial={items} />
    </div>
  );
}
