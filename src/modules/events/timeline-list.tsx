"use client";

import { useState } from "react";
import * as Icons from "lucide-react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { eventLabel } from "./labels";

interface TimelineEvent {
  id: string;
  kind: string;
  occurred_at: string;
  actor_name?: string | null;
  payload?: unknown;
}

const ICON_MAP: Record<string, keyof typeof Icons> = {
  "lead.created": "UserPlus",
  "lead.contacted": "Phone",
  "lead.status_changed": "RefreshCw",
  "lead.unassigned_by_expiry": "UserMinus",
  "customer.created": "Users",
  "customer.updated": "Pencil",
  "proposal.created": "FileText",
  "proposal.sent": "Send",
  "proposal.accepted": "Check",
  "proposal.rejected": "X",
  "contract.created": "FileSignature",
  "contract.signed": "FileCheck2",
  "contract.activated": "Power",
  "installation.scheduled": "Calendar",
  "installation.started": "Play",
  "installation.completed": "CheckCircle2",
  "maintenance.completed": "Wrench",
  "wallet.payment_recorded": "Wallet",
};

const COLLAPSED_COUNT = 5;

/**
 * Render cliente del timeline con colapso. Recibe los eventos ya cargados
 * desde el servidor (Timeline.tsx). Si hay más de COLLAPSED_COUNT eventos,
 * solo muestra los más recientes y un botón "Mostrar todos (N)" para
 * expandir. Pensado para fichas con mucha historia (clientes antiguos
 * con decenas de eventos) — antes el scroll del timeline saturaba la página.
 */
export function TimelineList({ events }: { events: TimelineEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = events.length;
  const collapsed = total > COLLAPSED_COUNT && !expanded;
  const visible = collapsed ? events.slice(0, COLLAPSED_COUNT) : events;
  const hiddenCount = total - visible.length;

  return (
    <div className="space-y-3">
      <ol className="relative space-y-4 border-l-2 border-border pl-6">
        {visible.map((ev) => {
          const Icon =
            (Icons as unknown as Record<
              string,
              React.ComponentType<{ className?: string }>
            >)[ICON_MAP[ev.kind] ?? "Circle"] ?? Icons.Circle;
          return (
            <li key={ev.id} className="relative">
              <span className="absolute -left-[33px] flex h-7 w-7 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {eventLabel(ev.kind)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(ev.occurred_at).toLocaleString("es-ES")}
                  </span>
                </div>
                {ev.actor_name && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    por {ev.actor_name}
                  </div>
                )}
                {ev.kind === "lead.unassigned_by_expiry" &&
                  (ev.payload as { previous_assigned_user_name?: string | null } | null)
                    ?.previous_assigned_user_name && (
                    <div className="mt-0.5 text-xs text-amber-700">
                      Estaba asignado a:{" "}
                      <strong>
                        {(
                          ev.payload as {
                            previous_assigned_user_name?: string | null;
                          }
                        ).previous_assigned_user_name}
                      </strong>
                    </div>
                  )}
              </div>
            </li>
          );
        })}
      </ol>
      {total > COLLAPSED_COUNT && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Mostrar menos
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Mostrar todo ({hiddenCount} más)
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
