import Link from "next/link";
import { listCustomers } from "@/modules/customers/actions";
import { Button } from "@/shared/ui/button";
import { requireSession } from "@/shared/lib/auth/session";
import { SelectableCustomersTable } from "@/modules/customers/selectable-list";
import { listTeamMembers } from "@/modules/agenda/actions";
import { ImportCustomersButton } from "@/modules/customers/import-form";
import {
  CustomerSmartAlerts,
  getCustomerAlerts,
} from "@/modules/customers/smart-alerts";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string; kind?: string }>;
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
  const kindFilter = sp.kind as "individual" | "autonomo" | "company" | undefined;
  const [customersAll, team, alerts] = await Promise.all([
    listCustomers(sp.q, scope),
    isUpperLevel ? listTeamMembers().catch(() => []) : Promise.resolve([]),
    isUpperLevel
      ? getCustomerAlerts().catch(() => null)
      : Promise.resolve(null),
  ]);
  // Filtro chips (decisión 2026-05-20): Particular / Autónomo / Empresa.
  const customers = kindFilter
    ? customersAll.filter((c) => {
        if (kindFilter === "individual") {
          return c.party_kind === "individual";
        }
        if (kindFilter === "autonomo") {
          return c.party_kind === "company" && c.is_autonomo === true;
        }
        // "company" pura (empresa NO autónoma)
        return c.party_kind === "company" && c.is_autonomo !== true;
      })
    : customersAll;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-muted-foreground">{customers.length} clientes</p>
        </div>
        <div className="flex items-center gap-2">
          {isUpperLevel && <ImportCustomersButton />}
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

      {/* Filtro chips por tipo (decisión 2026-05-20) */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: "", label: "Todos", count: customersAll.length },
          {
            key: "individual",
            label: "Particular",
            count: customersAll.filter((c) => c.party_kind === "individual").length,
          },
          {
            key: "autonomo",
            label: "Autónomo",
            count: customersAll.filter(
              (c) => c.party_kind === "company" && c.is_autonomo === true,
            ).length,
          },
          {
            key: "company",
            label: "Empresa",
            count: customersAll.filter(
              (c) => c.party_kind === "company" && c.is_autonomo !== true,
            ).length,
          },
        ].map((chip) => {
          const params = new URLSearchParams();
          if (scope === "mine") params.set("scope", "mine");
          if (sp.q) params.set("q", sp.q);
          if (chip.key) params.set("kind", chip.key);
          const active = (kindFilter ?? "") === chip.key;
          return (
            <Link
              key={chip.key || "all"}
              href={`/clientes?${params.toString()}` as never}
              prefetch={false}
              className={`inline-flex h-9 items-center gap-2 rounded-xl border-2 px-3 text-xs font-bold transition ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              {chip.label}
              <span className="rounded-md bg-black/10 px-1.5 py-0.5 tabular-nums">
                {chip.count}
              </span>
            </Link>
          );
        })}
      </div>

      <form className="rounded-lg border bg-card p-4">
        {scope === "mine" && <input type="hidden" name="scope" value="mine" />}
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar por nombre, email, teléfono, CIF/DNI…"
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </form>

      <SelectableCustomersTable
        customers={customers}
        team={team}
        canBulkReassign={
          session.is_superadmin || session.roles.includes("company_admin")
        }
      />
    </div>
  );
}
