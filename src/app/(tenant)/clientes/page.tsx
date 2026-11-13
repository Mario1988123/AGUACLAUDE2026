import Link from "next/link";
import { listCustomers } from "@/modules/customers/actions";
import { Button } from "@/shared/ui/button";
import { requireSession } from "@/shared/lib/auth/session";
import { CustomersFilteredView } from "@/modules/customers/filtered-view";
import { listTeamMembers } from "@/modules/agenda/actions";
import { ImportCustomersButton } from "@/modules/customers/import-form";
import {
  CustomerSmartAlerts,
  getCustomerAlerts,
} from "@/modules/customers/smart-alerts";
import { ScrollToOnMount } from "@/shared/components/scroll-to-on-mount";
import { esSoloTecnico } from "@/shared/lib/auth/role-scope";
import { listarMisClientesPendientes } from "@/modules/customers/tecnico-actions";
import { MisClientesTecnico } from "@/modules/customers/mis-clientes-tecnico";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  // Solo técnico (2026-11-12): ve sus clientes pendientes, nada más.
  if (esSoloTecnico(session)) {
    const clientes = await listarMisClientesPendientes();
    return <MisClientesTecnico clientes={clientes} />;
  }
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

  // Enlace a «Equipos sin identificar» (plan modelo de equipo): oficina y
  // solo si la migración está aplicada.
  const puedeVerPendientesModelo =
    (session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("technical_director")) &&
    (await import("@/modules/equipos-modelo/datos")
      .then((m) => m.modeloEquipoDisponible())
      .catch(() => false));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-muted-foreground">{customersAll.length} clientes</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isUpperLevel && <ImportCustomersButton />}
          {/* Generador de contratos heredados RETIRADO (Mario 2026-11-09): lo
              heredado no son contratos, son equipos ya instalados. */}
          {puedeVerPendientesModelo && (
            <Link
              href={"/clientes/equipos-pendientes" as never}
              prefetch={false}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
            >
              Equipos sin identificar
            </Link>
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
