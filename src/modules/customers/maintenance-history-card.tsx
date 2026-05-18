import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Wrench } from "lucide-react";

export interface MaintenanceHistoryRow {
  id: string;
  completed_at: string;
  technician_name: string | null;
  kind: string;
  charge_cents: number | null;
  is_charged: boolean;
  nps_score: number | null;
  replaced_items: Array<{ product_name: string; quantity: number }>;
}

const KIND_LABEL: Record<string, string> = {
  contracted: "Contratado",
  one_off: "Puntual",
  warranty: "Garantía",
};

function eur(c: number | null): string {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(
    c / 100,
  );
}

export function MaintenanceHistoryCard({ rows }: { rows: MaintenanceHistoryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Wrench className="h-5 w-5" />
          Histórico de mantenimientos
          <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border bg-card p-3 text-sm"
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/mantenimientos/${r.id}` as never}
                    className="font-semibold text-primary hover:underline"
                  >
                    {new Date(r.completed_at).toLocaleDateString("es-ES", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {KIND_LABEL[r.kind] ?? r.kind}
                    {r.technician_name && ` · ${r.technician_name}`}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {r.nps_score != null && (
                    <Badge
                      variant={
                        r.nps_score >= 4
                          ? "success"
                          : r.nps_score >= 3
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      NPS {r.nps_score}/5
                    </Badge>
                  )}
                  {r.is_charged && r.charge_cents != null && (
                    <span className="text-sm font-bold tabular-nums">
                      {eur(r.charge_cents)}
                    </span>
                  )}
                </div>
              </div>
              {r.replaced_items.length > 0 && (
                <div className="mt-2 border-t pt-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Piezas sustituidas
                  </div>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {r.replaced_items.map((it, idx) => (
                      <li
                        key={idx}
                        className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
                      >
                        <strong>{it.quantity}×</strong> {it.product_name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export async function getCustomerMaintenanceHistory(
  customerId: string,
): Promise<MaintenanceHistoryRow[]> {
  const { createAdminClient } = await import("@/shared/lib/supabase/admin");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data: jobs } = await admin
      .from("maintenance_jobs")
      .select("id, completed_at, kind, charge_cents, is_charged, nps_score, technician_user_id")
      .eq("customer_id", customerId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(50);
    type J = {
      id: string;
      completed_at: string;
      kind: string;
      charge_cents: number | null;
      is_charged: boolean;
      nps_score: number | null;
      technician_user_id: string | null;
    };
    const list = (jobs ?? []) as J[];
    if (list.length === 0) return [];

    const technicianIds = Array.from(
      new Set(list.map((j) => j.technician_user_id).filter((v): v is string => !!v)),
    );
    const jobIds = list.map((j) => j.id);
    const [profsRes, replacedRes] = await Promise.all([
      technicianIds.length > 0
        ? admin
            .from("user_profiles")
            .select("user_id, full_name")
            .in("user_id", technicianIds)
        : Promise.resolve({ data: [] }),
      admin
        .from("maintenance_items_replaced")
        .select("maintenance_job_id, product_id, quantity")
        .in("maintenance_job_id", jobIds),
    ]);
    const profMap = new Map(
      ((profsRes.data ?? []) as Array<{ user_id: string; full_name: string }>).map(
        (p) => [p.user_id, p.full_name],
      ),
    );
    const replacedRows = (replacedRes.data ?? []) as Array<{
      maintenance_job_id: string;
      product_id: string;
      quantity: number;
    }>;
    const productIds = Array.from(new Set(replacedRows.map((r) => r.product_id)));
    let productMap = new Map<string, string>();
    if (productIds.length > 0) {
      const { data: prods } = await admin
        .from("products")
        .select("id, name")
        .in("id", productIds);
      productMap = new Map(
        ((prods ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
      );
    }
    const replacedByJob = new Map<string, MaintenanceHistoryRow["replaced_items"]>();
    for (const r of replacedRows) {
      if (!replacedByJob.has(r.maintenance_job_id)) {
        replacedByJob.set(r.maintenance_job_id, []);
      }
      replacedByJob.get(r.maintenance_job_id)!.push({
        product_name: productMap.get(r.product_id) ?? "Producto",
        quantity: r.quantity,
      });
    }
    return list.map((j) => ({
      id: j.id,
      completed_at: j.completed_at,
      kind: j.kind,
      charge_cents: j.charge_cents,
      is_charged: j.is_charged,
      nps_score: j.nps_score,
      technician_name: j.technician_user_id
        ? profMap.get(j.technician_user_id) ?? null
        : null,
      replaced_items: replacedByJob.get(j.id) ?? [],
    }));
  } catch {
    return [];
  }
}
