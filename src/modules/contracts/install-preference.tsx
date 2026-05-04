"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sun, Moon, CalendarClock, Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import { saveInstallPreferenceAction } from "./actions";

type Slot = "morning" | "afternoon" | "any" | "custom";

const OPTIONS: Array<{ value: Slot; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { value: "morning", label: "Mañana (9–14h)", icon: Sun },
  { value: "afternoon", label: "Tarde (16–20h)", icon: Moon },
  { value: "any", label: "Cualquier hora", icon: CalendarClock },
  { value: "custom", label: "Otra (escribir)", icon: CalendarClock },
];

export function InstallPreference({
  contractId,
  initialSlot,
  initialNotes,
  canEdit,
}: {
  contractId: string;
  initialSlot: Slot | null;
  initialNotes: string | null;
  canEdit: boolean;
}) {
  const [slot, setSlot] = useState<Slot | null>(initialSlot);
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save() {
    if (!slot) {
      notify.warning("Elige una franja");
      return;
    }
    if (slot === "custom" && !notes.trim()) {
      notify.warning("Indica el horario preferido en el campo de texto");
      return;
    }
    startTransition(async () => {
      try {
        await saveInstallPreferenceAction(contractId, slot, notes || null);
        notify.success("Preferencia guardada");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {OPTIONS.map((o) => {
          const Icon = o.icon;
          const active = slot === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => canEdit && setSlot(o.value)}
              disabled={!canEdit}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 p-3 text-center text-xs font-semibold ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card hover:border-primary/40"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              <Icon className="h-5 w-5" />
              {o.label}
            </button>
          );
        })}
      </div>
      {slot === "custom" && (
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Ej. lunes y martes mañana, fines de semana, etc."
          disabled={!canEdit}
        />
      )}
      {slot && slot !== "custom" && (
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas adicionales (opcional)"
          disabled={!canEdit}
        />
      )}
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={save} disabled={pending} size="sm">
            <Save className="h-3 w-3" /> {pending ? "Guardando…" : "Guardar preferencia"}
          </Button>
        </div>
      )}
    </div>
  );
}
