import { requireSession } from "@/shared/lib/auth/session";
import { redirect } from "next/navigation";
import { findCustomerDuplicates } from "@/modules/customers/merge-actions";
import { DuplicatesManager } from "@/modules/customers/duplicates-manager";

export const dynamic = "force-dynamic";

export default async function DuplicadosPage() {
  const session = await requireSession();
  const isUpper =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (!isUpper) redirect("/clientes" as never);

  const groups = await findCustomerDuplicates();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Clientes duplicados</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {groups.length === 0
            ? "Sin duplicados detectados. ¡Todo limpio!"
            : `${groups.length} grupo(s) con coincidencias por DNI/email/teléfono.`}
        </p>
      </div>
      <DuplicatesManager groups={groups} />
    </div>
  );
}
