import Link from "next/link";
import { listCustomers } from "@/modules/customers/actions";
import { Button } from "@/shared/ui/button";
import { requireSession } from "@/shared/lib/auth/session";
import { SelectableCustomersTable } from "@/modules/customers/selectable-list";
import { listTeamMembers } from "@/modules/agenda/actions";
import { ImportCustomersButton } from "@/modules/customers/import-form";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string }>;
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
  const [customers, team] = await Promise.all([
    listCustomers(sp.q, scope),
    isUpperLevel ? listTeamMembers().catch(() => []) : Promise.resolve([]),
  ]);

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

      <form className="rounded-lg border bg-card p-4">
        {scope === "mine" && <input type="hidden" name="scope" value="mine" />}
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar..."
          className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </form>

      <SelectableCustomersTable customers={customers} team={team} canBulkReassign={isUpperLevel} />
    </div>
  );
}
