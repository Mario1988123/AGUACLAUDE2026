import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { getWarehouseSettings } from "@/modules/warehouses/settings-actions";
import { listPendingPurchaseSuggestions } from "@/modules/warehouses/purchase-suggestions-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { WarehouseSettingsForm } from "@/modules/warehouses/settings-form";
import { BackButton } from "@/shared/components/back-button";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function ConfiguracionAlmacenesPage() {
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  if (!isAdmin) redirect("/almacenes" as never);

  const [settings, pendingSuggestions] = await Promise.all([
    getWarehouseSettings(),
    listPendingPurchaseSuggestions().catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Configuración · Almacenes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Política de valoración, alertas y comportamiento del stock.
          </p>
        </div>
        <BackButton href="/configuracion" />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={"/almacenes" as never}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          📦 Vista operativa /almacenes
        </Link>
        <Link
          href={"/almacenes/sugerencias" as never}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          🛒 Sugerencias pedido ({pendingSuggestions.length})
        </Link>
        <Link
          href={"/almacenes/informes" as never}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
        >
          📊 Informes
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuración</CardTitle>
        </CardHeader>
        <CardContent>
          <WarehouseSettingsForm initial={settings} />
        </CardContent>
      </Card>
    </div>
  );
}
