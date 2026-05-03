import { cn } from "@/shared/lib/utils";

interface Props {
  deadlineAt: string | null;
  status: string;
}

/**
 * Muestra el tiempo restante hasta el vencimiento del SLA. Si la incidencia
 * está resuelta o cerrada, muestra "—". Si vencida, pinta en rojo.
 */
export function SlaPill({ deadlineAt, status }: Props) {
  if (!deadlineAt || status === "resolved" || status === "closed" || status === "cancelled") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const now = Date.now();
  const target = new Date(deadlineAt).getTime();
  const diffMs = target - now;
  const overdue = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const hours = Math.floor(absMs / 3600000);
  const mins = Math.floor((absMs % 3600000) / 60000);
  const label = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        overdue
          ? "bg-red-100 text-red-700"
          : hours < 1
            ? "bg-amber-100 text-amber-700"
            : "bg-emerald-100 text-emerald-700",
      )}
      title={`Vence: ${new Date(deadlineAt).toLocaleString("es-ES")}`}
    >
      {overdue ? `⚠ Vencida ${label}` : `⏱ ${label}`}
    </span>
  );
}
