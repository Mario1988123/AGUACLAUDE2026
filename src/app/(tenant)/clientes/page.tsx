import Link from "next/link";
import { listCustomers } from "@/modules/customers/actions";
import { Button } from "@/shared/ui/button";
import { requireSession } from "@/shared/lib/auth/session";
import { CustomersFilteredView } from "@/modules/customers/filtered-view";
import { listTeamMembers } from "@/modules/agenda/actions";
import { ImportCustomersButton } from "@/modules/customers/import-form";
import { GenerateLegacyContractsButton } from "@/modules/contracts/generate-legacy-button";
import {
  CustomerSmartAlerts,
  getCustomerAlerts,
} from "@/modules/customers/smart-alerts";
import { ScrollToOnMount } from "@/shared/components/scroll-to-on-mount";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  const isUpperLevel =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director") ||
    session.roles.includes("telemarketing_director") ||
    session.roles.includes("technical_director");
  const scope: "mine" | "all" = isUpperLevel
    ? sp.scope === "mine"
      ? "mine"
      : "all"
    : "mine";
  const [customersAll, team, alerts] = await Promise.all([
    listCustomers(undefined, scope),
    isUpperLevel ? listTeamMembers().catch(() => []) : Promise.resolve([]),
    isUpperLevel
      ? getCustomerAlerts().catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-muted-foreground">{customersAll.length} clientes</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isUpperLevel && <ImportCustomersButton />}
          {(session.is_superadmin || session.roles.includes("company_admin")) && (
            <GenerateLegacyContractsButton />
          )}
          {isUpperLevel && (
            <Link
              href={"/clientes/duplicados" as never}
              prefetch={false}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
            >
              ⚠ Duplicados
            </Link>
          )}
          <Link
            href={"/api/export/customers" as never}
            prefetch={false}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            ⬇ Exportar CSV
          </Link>
          <Button asChild>
            <Link href={"/clientes/nuevo" as never}>+ Nuevo cliente</Link>
          </Button>
        </div>
      </div>

      {isUpperLevel && (
        <div className="flex gap-2">
          <Link
            href={"/clientes" as never}
            prefetch={false}
            className={`inline-flex h-10 items-center rounded-xl border-2 px-4 text-sm font-semibold ${
              scope === "all"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            Todos
          </Link>
          <Link
            href={"/clientes?scope=mine" as never}
            prefetch={false}
            className={`inline-flex h-10 items-center rounded-xl border-2 px-4 text-sm font-semibold ${
              scope === "mine"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            Mi cartera
          </Link>
        </div>
      )}

      {isUpperLevel && alerts && <CustomerSmartAlerts alerts={alerts} />}

      {/* Autoscroll a la tabla, saltándose cabecera, pestañas y alertas
          (siguen accesibles subiendo). Sobre todo para tablet/móvil. */}
      <ScrollToOnMount targetId="clientes-content" />
      <div id="clientes-content" className="scroll-mt-20">
        <CustomersFilteredView
          customers={customersAll}
          team={team}
          canBulkReassign={
            session.is_superadmin || session.roles.includes("company_admin")
          }
        />
      </div>
    </div>
  );
}
