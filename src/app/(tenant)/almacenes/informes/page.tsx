import { redirect } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BackButton } from "@/shared/components/back-button";
import { SnLookup } from "@/modules/warehouses/sn-lookup";
import { BarcodeScanner } from "@/modules/warehouses/barcode-scanner";

export const dynamic = "force-dynamic";

function eur(c: number | null | undefined): string {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(c / 100);
}

export default async function InformesPage() {
  const session = await requireSession();
  const isAdmin =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("technical_director");
  if (!isAdmin) redirect("/almacenes" as never);
  if (!session.company_id) redirect("/dashboard" as never);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // === Valor total del inventario (suma stock × cost_cents del producto) ===
  const { data: stocks } = await admin
    .from("warehouse_stock")
    .select("product_id, quantity, warehouse_id");
  type S = { product_id: string; quantity: number; warehouse_id: string };
  const stockRows = (stocks ?? []) as S[];

  const productIds = Array.from(new Set(stockRows.map((s) => s.product_id)));
  const { data: prods } = productIds.length
    ? await admin
        .from("products")
        .select("id, name, cost_cents")
        .in("id", productIds)
    : { data: [] };
  type P = { id: string; name: string; cost_cents: number | null };
  const productMap = new Map<string, P>();
  for (const p of (prods ?? []) as P[]) productMap.set(p.id, p);

  let totalValue = 0;
  const valueByProduct = new Map<string, { name: string; qty: number; value: number }>();
  for (const s of stockRows) {
    const p = productMap.get(s.product_id);
    const cost = Number(p?.cost_cents ?? 0);
    const qty = Number(s.quantity);
    const v = cost * qty;
    totalValue += v;
    const prev = valueByProduct.get(s.product_id) ?? {
      name: p?.name ?? "—",
      qty: 0,
      value: 0,
    };
    valueByProduct.set(s.product_id, {
      name: prev.name,
      qty: prev.qty + qty,
      value: prev.value + v,
    });
  }

  // === Top 10 productos por valor ===
  const topByValue = Array.from(valueByProduct.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // === Top 10 movidos último mes ===
  const since = new Date();
  since.setMonth(since.getMonth() - 1);
  const { data: movs } = await admin
    .from("stock_movements")
    .select("product_id, quantity, movement_type, performed_at")
    .gte("performed_at", since.toISOString())
    .limit(5000);
  type M = {
    product_id: string;
    quantity: number;
    movement_type: string;
    performed_at: string;
  };
  const movByProduct = new Map<string, number>();
  for (const m of (movs ?? []) as M[]) {
    if (m.movement_type === "adjustment") continue;
    movByProduct.set(
      m.product_id,
      (movByProduct.get(m.product_id) ?? 0) + Math.abs(Number(m.quantity)),
    );
  }
  const topMovedIds = Array.from(movByProduct.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const movedNames = await (async () => {
    const ids = topMovedIds.map(([id]) => id);
    if (!ids.length) return new Map<string, string>();
    const { data: ps } = await admin
      .from("products")
      .select("id, name")
      .in("id", ids);
    const m = new Map<string, string>();
    for (const p of (ps ?? []) as Array<{ id: string; name: string }>)
      m.set(p.id, p.name);
    return m;
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Informes de almacén
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Valoración del stock, productos top y trazabilidad por número de serie.
          </p>
        </div>
        <BackButton href="/almacenes" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Valor total del inventario</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-extrabold tabular-nums">
            {eur(totalValue)}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Σ (stock × coste medio del producto). Si un producto no tiene
            cost_cents informado, no se suma.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top 10 productos por valor</CardTitle>
          </CardHeader>
          <CardContent>
            {topByValue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin datos.</p>
            ) : (
              <ul className="divide-y">
                {topByValue.map((v, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between py-1.5 text-sm"
                  >
                    <span className="truncate">{v.name}</span>
                    <span className="tabular-nums">
                      {v.qty} ud · <strong>{eur(v.value)}</strong>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top 10 movidos (último mes)</CardTitle>
          </CardHeader>
          <CardContent>
            {topMovedIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Sin movimientos en el último mes.
              </p>
            ) : (
              <ul className="divide-y">
                {topMovedIds.map(([id, q]) => (
                  <li
                    key={id}
                    className="flex items-center justify-between py-1.5 text-sm"
                  >
                    <Link
                      href={`/productos/${id}` as never}
                      className="truncate hover:underline"
                    >
                      {movedNames.get(id) ?? "—"}
                    </Link>
                    <span className="tabular-nums">{q} ud</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Buscar por número de serie</CardTitle>
        </CardHeader>
        <CardContent>
          <SnLookup />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Escáner de código de barras</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Identifica un producto por su código de fabricante. Si no
            está memorizado, ve a la ficha del producto y usa &quot;Asociar
            barcode&quot; para guardarlo (memorización única).
          </p>
          <BarcodeScanner />
        </CardContent>
      </Card>
    </div>
  );
}
