import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { listStockCounts } from "@/modules/warehouses/stock-count-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { BackButton } from "@/shared/components/back-button";
import Link from "next/link";
import { listWarehouses } from "@/modules/warehouses/actions";
import { StartCountButton } from "@/modules/warehouses/start-count-button";

export const dynamic = "force-dynamic";

export default async function CountsPage() {
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director") ||
    session.roles.includes("installer");
  if (!isAdmin) redirect("/almacenes" as never);

  const [counts, warehouses] = await Promise.all([
    listStockCounts(),
    listWarehouses().catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Conteos cíclicos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuenta el stock real de un almacén y aplica ajustes automáticamente
            por las diferencias.
          </p>
        </div>
        <div className="flex gap-2">
          <StartCountButton
            warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
          />
          <BackButton href="/almacenes" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conteos ({counts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {counts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay conteos. Pulsa &quot;Nuevo conteo&quot; arriba para empezar.
            </p>
          ) : (
            <ul className="divide-y">
              {counts.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <div>
                    <Link
                      href={`/almacenes/conteo/${c.id}` as never}
                      className="font-semibold hover:underline"
                    >
                      {c.label}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {c.warehouse_name ?? "—"} ·{" "}
                      {new Date(c.started_at).toLocaleDateString("es-ES")}
                    </div>
                  </div>
                  <Badge
                    variant={
                      c.status === "completed"
                        ? "success"
                        : c.status === "cancelled"
                          ? "secondary"
                          : "warning"
                    }
                  >
                    {c.status === "open"
                      ? "Abierto"
                      : c.status === "completed"
                        ? "Completado"
                        : "Cancelado"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
