import { notFound } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { BackButton } from "@/shared/components/back-button";
import { CountItemsForm } from "@/modules/warehouses/count-items-form";

export const dynamic = "force-dynamic";

export default async function CountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireSession();
  if (!session.company_id) notFound();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: header } = await admin
    .from("stock_counts")
    .select("id, label, status, warehouse_id, started_at, completed_at")
    .eq("id", id)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!header) notFound();
  const h = header as {
    id: string;
    label: string;
    status: string;
    warehouse_id: string;
    started_at: string;
    completed_at: string | null;
  };

  const { data: items } = await admin
    .from("stock_count_items")
    .select("id, product_id, expected_qty, counted_qty, diff")
    .eq("count_id", id)
    .order("expected_qty", { ascending: false });
  type I = {
    id: string;
    product_id: string;
    expected_qty: number;
    counted_qty: number | null;
    diff: number | null;
  };
  const rows = (items ?? []) as I[];
  const pIds = Array.from(new Set(rows.map((r) => r.product_id)));
  const { data: prods } = await admin
    .from("products")
    .select("id, name, sku, barcode")
    .in("id", pIds);
  type P = { id: string; name: string; sku: string | null; barcode: string | null };
  const productMap = new Map<string, P>();
  for (const p of (prods ?? []) as P[]) productMap.set(p.id, p);

  const enriched = rows.map((r) => ({
    ...r,
    product_name: productMap.get(r.product_id)?.name ?? "—",
    product_sku: productMap.get(r.product_id)?.sku ?? null,
    product_barcode: productMap.get(r.product_id)?.barcode ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{h.label}</h1>
          <p className="text-sm text-muted-foreground">
            Estado: <strong>{h.status}</strong>
            {h.completed_at &&
              ` · Completado ${new Date(h.completed_at).toLocaleString("es-ES")}`}
          </p>
        </div>
        <BackButton href="/almacenes/conteo" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Productos del conteo ({enriched.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <CountItemsForm
            countId={id}
            initialStatus={h.status as "open" | "completed" | "cancelled"}
            items={enriched}
          />
        </CardContent>
      </Card>
    </div>
  );
}
