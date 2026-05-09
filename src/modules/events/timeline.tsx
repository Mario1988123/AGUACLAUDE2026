import * as Icons from "lucide-react";
import { listSubjectEvents } from "./actions";
import { eventLabel } from "./labels";

interface Props {
  subjectType: string;
  subjectId: string;
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

export async function Timeline({ subjectType, subjectId }: Props) {
  const events = await listSubjectEvents(subjectType, subjectId);

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin eventos todavía. Aquí aparecerá el historial conforme se trabaje con esta entidad.
      </p>
    );
  }

  return (
    <ol className="relative space-y-4 border-l-2 border-border pl-6">
      {events.map((ev) => {
        const Icon =
          (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
            ICON_MAP[ev.kind] ?? "Circle"
          ] ?? Icons.Circle;
        return (
          <li key={ev.id} className="relative">
            <span className="absolute -left-[33px] flex h-7 w-7 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{eventLabel(ev.kind)}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(ev.occurred_at).toLocaleString("es-ES")}
                </span>
              </div>
              {ev.actor_name && (
                <div className="mt-0.5 text-xs text-muted-foreground">por {ev.actor_name}</div>
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
  );
}
