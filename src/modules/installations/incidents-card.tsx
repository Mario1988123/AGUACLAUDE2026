import Link from "next/link";
import { AlertTriangle, Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

interface Row {
  id: string;
  reference_code: string | null;
  customer_name: string | null;
  kind: string;
  updated_at: string;
}

export function InstallationsWithIncidentCard({ items }: { items: Row[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="border-2 border-red-300 bg-red-50/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-900">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          Instalaciones con incidencia abierta ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((i) => (
            <li
              key={i.id}
              className="flex items-center gap-2 rounded-xl border border-red-200 bg-white p-3"
            >
              <Wrench className="h-4 w-4 shrink-0 text-red-600" />
              <Link
                href={`/instalaciones/${i.id}` as never}
                className="min-w-0 flex-1 text-sm font-semibold text-red-900 hover:underline truncate"
              >
                {i.customer_name ?? i.reference_code ?? i.id.slice(0, 8)}
              </Link>
              <span className="text-xs text-red-700">
                {new Date(i.updated_at).toLocaleDateString("es-ES")}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export async function getInstallationsWithIncident(): Promise<Row[]> {
  const { createClient } = await import("@/shared/lib/supabase/server");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("installations")
    .select("id, reference_code, kind, updated_at, customer_id")
    .eq("company_id", session.company_id)
    .eq("status", "incident_pending")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(10);
  const rows = (data ?? []) as Array<{
    id: string;
    reference_code: string | null;
    kind: string;
    updated_at: string;
    customer_id: string | null;
  }>;
  if (rows.length === 0) return [];
  const customerIds = Array.from(
    new Set(rows.map((r) => r.customer_id).filter((x): x is string => !!x)),
  );
  let nameMap = new Map<string, string>();
  if (customerIds.length > 0) {
    const { data: cs } = await supabase
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name")
      .in("id", customerIds);
    nameMap = new Map(
      ((cs ?? []) as Array<{
        id: string;
        party_kind: "individual" | "company";
        legal_name: string | null;
        trade_name: string | null;
        first_name: string | null;
        last_name: string | null;
      }>).map((c) => [
        c.id,
        c.party_kind === "company"
          ? c.trade_name || c.legal_name || "—"
          : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "—",
      ]),
    );
  }
  return rows.map((r) => ({
    id: r.id,
    reference_code: r.reference_code,
    kind: r.kind,
    updated_at: r.updated_at,
    customer_name: r.customer_id ? nameMap.get(r.customer_id) ?? null : null,
  }));
}
