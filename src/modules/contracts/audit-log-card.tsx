import { createAdminClient } from "@/shared/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { History } from "lucide-react";

const FIELD_LABELS: Record<string, string> = {
  total_cash_cents: "Importe contado",
  monthly_cents: "Cuota mensual",
  duration_months: "Duración (meses)",
  plan_type: "Tipo de plan",
  financier_id: "Financiera",
  status: "Estado",
  maintenance_periodicity_months: "Periodicidad mantenimiento",
};

function formatValue(field: string, value: string | null): string {
  if (value == null) return "—";
  if (field.endsWith("_cents")) {
    const n = parseInt(value, 10);
    if (Number.isFinite(n)) return `${(n / 100).toFixed(2)}€`;
  }
  return value;
}

export async function ContractAuditLogCard({
  contractId,
}: {
  contractId: string;
}) {
  let rows: Array<{
    id: string;
    field: string;
    old_value: string | null;
    new_value: string | null;
    changed_by: string | null;
    changed_at: string;
    changed_by_name?: string | null;
  }> = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data } = await admin
      .from("contract_audit_log")
      .select("id, field, old_value, new_value, changed_by, changed_at")
      .eq("contract_id", contractId)
      .order("changed_at", { ascending: false })
      .limit(100);
    rows = (data ?? []) as typeof rows;

    // Resolver nombres
    const userIds = Array.from(
      new Set(rows.map((r) => r.changed_by).filter((u): u is string => !!u)),
    );
    if (userIds.length > 0) {
      const { data: profs } = await admin
        .from("user_profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      const map = new Map(
        ((profs ?? []) as Array<{ user_id: string; full_name: string | null }>).map(
          (p) => [p.user_id, p.full_name ?? "Usuario"],
        ),
      );
      rows = rows.map((r) => ({
        ...r,
        changed_by_name: r.changed_by ? map.get(r.changed_by) ?? "—" : "Sistema",
      }));
    }
  } catch {
    // Migración pendiente o RLS
    return null;
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Histórico de cambios
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Sin cambios registrados. Cualquier modificación a importe, cuota,
            duración, financiera o estado quedará aquí.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Histórico de cambios ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.id} className="py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {FIELD_LABELS[r.field] ?? r.field}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(r.changed_at).toLocaleString("es-ES")}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-900 line-through">
                  {formatValue(r.field, r.old_value)}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-900">
                  {formatValue(r.field, r.new_value)}
                </span>
                <span className="ml-auto text-muted-foreground">
                  por <strong>{r.changed_by_name ?? "Sistema"}</strong>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
