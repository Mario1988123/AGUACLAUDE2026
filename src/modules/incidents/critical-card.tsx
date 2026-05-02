import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

interface Row {
  id: string;
  reference_code: string | null;
  title: string;
  priority: string;
  status: string;
  created_at: string;
}

const PRIORITY_LABEL: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  critical: "Crítica",
};
const PRIORITY_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  low: "outline",
  medium: "secondary",
  high: "warning",
  critical: "destructive",
};

export function CriticalIncidentsCard({ items }: { items: Row[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Incidencias críticas abiertas ({items.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
            >
              <Badge variant={PRIORITY_VARIANT[i.priority]}>
                {PRIORITY_LABEL[i.priority]}
              </Badge>
              <Link
                href={`/incidencias/${i.id}` as never}
                className="min-w-0 flex-1 text-sm font-semibold hover:underline truncate"
              >
                {i.title}
              </Link>
              <span className="text-xs text-muted-foreground">
                {new Date(i.created_at).toLocaleDateString("es-ES")}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export async function getCriticalOpenIncidents(): Promise<Row[]> {
  const { createClient } = await import("@/shared/lib/supabase/server");
  const { requireSession } = await import("@/shared/lib/auth/session");
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data } = await supabase
    .from("incidents")
    .select("id, reference_code, title, priority, status, created_at")
    .eq("company_id", session.company_id)
    .in("priority", ["high", "critical"])
    .in("status", ["open", "assigned", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(8);
  return (data ?? []) as Row[];
}
