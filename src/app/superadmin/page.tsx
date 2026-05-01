import Link from "next/link";
import { listCompanies } from "@/modules/superadmin/companies/actions";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";

const statusVariant = {
  trial: "warning",
  active: "success",
  suspended: "destructive",
  cancelled: "secondary",
} as const;

const statusLabel = {
  trial: "Prueba",
  active: "Activa",
  suspended: "Suspendida",
  cancelled: "Cancelada",
} as const;

function formatCents(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export default async function SuperadminCompaniesPage() {
  const companies = await listCompanies();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Empresas</h1>
          <p className="text-sm text-muted-foreground">{companies.length} empresas registradas</p>
        </div>
        <Button asChild>
          <Link href={"/superadmin/empresas/nueva" as never}>+ Nueva empresa</Link>
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Nombre</th>
              <th className="px-4 py-3 text-left">Slug</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-right">Usuarios máx.</th>
              <th className="px-4 py-3 text-right">Coste/mes</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {companies.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No hay empresas. Crea la primera para empezar.
                </td>
              </tr>
            ) : (
              companies.map((c) => {
                const status = c.status as keyof typeof statusVariant;
                return (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link
                        href={`/superadmin/empresas/${c.id}` as never}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{c.slug}</td>
                    <td className="px-4 py-3">
                      <Badge variant={statusVariant[status]}>{statusLabel[status]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{c.max_users}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatCents(c.monthly_cost_cents)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/superadmin/empresas/${c.id}` as never}
                        className="text-sm text-primary hover:underline"
                      >
                        Editar
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
