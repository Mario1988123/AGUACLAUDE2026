import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/shared/lib/auth/session";
import { listPendingPurchaseSuggestions } from "@/modules/warehouses/purchase-suggestions-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BackButton } from "@/shared/components/back-button";
import { SuggestionActions } from "@/modules/warehouses/suggestion-row-actions";
import { RecomputeSuggestionsButton } from "@/modules/warehouses/recompute-suggestions-button";

export const dynamic = "force-dynamic";

export default async function PurchaseSuggestionsPage() {
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  if (!isAdmin) redirect("/almacenes" as never);

  const suggestions = await listPendingPurchaseSuggestions();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Sugerencias de pedido
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Productos por debajo del mínimo. Acumúlalos y crea pedidos
            agrupados cuando alcances el mínimo del proveedor.
          </p>
        </div>
        <div className="flex gap-2">
          <RecomputeSuggestionsButton />
          <BackButton href="/almacenes" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pendientes ({suggestions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {suggestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay sugerencias pendientes. Pulsa{" "}
              <strong>Recalcular</strong> arriba para revisar stock vs
              mínimo.
            </p>
          ) : (
            <ul className="divide-y">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <Link
                      href={`/productos/${s.product_id}` as never}
                      className="font-semibold hover:underline"
                    >
                      {s.product_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      Sugerido: <strong>{Number(s.suggested_qty)}</strong> ud{" "}
                      {s.reason && ` · ${s.reason}`}
                    </div>
                  </div>
                  <SuggestionActions
                    id={s.id}
                    suggestedQty={Number(s.suggested_qty)}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Próximo paso</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Cuando un proveedor te exija pedido mínimo, aprueba varias
            sugerencias suyas hasta llegar al importe necesario, luego
            crea la compra agrupada desde{" "}
            <Link href={"/almacenes" as never} className="text-primary hover:underline">
              /almacenes → Compras
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
