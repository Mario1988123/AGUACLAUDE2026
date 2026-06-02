import Link from "next/link";
import { Wrench } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { formatDateTimeES } from "@/shared/lib/format-date";

interface Row {
  id: string;
  reference_code: string | null;
  status: string;
  kind: string;
  scheduled_at: string | null;
  completed_at: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  unscheduled: "Sin programar",
  scheduled: "Programada",
  in_progress: "En curso",
  paused: "Pausada",
  completed: "Completada",
  cancelled: "Cancelada",
};
const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "success" | "warning" | "destructive" | "outline"
> = {
  unscheduled: "secondary",
  scheduled: "default",
  in_progress: "warning",
  paused: "outline",
  completed: "success",
  cancelled: "destructive",
};

// Antes usaba new Date(d).toLocaleString("es-ES") que en SSR (Vercel UTC)
// mostraba hora UTC en vez de Madrid (ej: 20:35 en vez de 22:35 en CEST).
// El helper formatDateTimeES fuerza timeZone "Europe/Madrid".
function fmt(d: string | null) {
  return formatDateTimeES(d);
}

export function CustomerInstallationsCard({ installations }: { installations: Row[] }) {
  if (installations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin instalaciones. Se generan al firmar el contrato.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {installations.map((i) => (
        <li
          key={i.id}
          className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Wrench className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <Link
              href={`/instalaciones/${i.id}` as never}
              className="text-sm font-semibold hover:underline"
            >
              {i.reference_code ?? `#${i.id.slice(0, 8)}`}
            </Link>
            <div className="text-xs text-muted-foreground">
              {i.kind} · Prog: {fmt(i.scheduled_at)}
              {i.completed_at && ` · Completada ${fmt(i.completed_at)}`}
            </div>
          </div>
          <Badge variant={STATUS_VARIANT[i.status] ?? "default"}>
            {STATUS_LABEL[i.status] ?? i.status}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
