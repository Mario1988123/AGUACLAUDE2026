"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { notify } from "@/shared/hooks/use-toast";
import { setInstallationPriorityAction } from "./actions";

type Priority = "low" | "normal" | "high" | "urgent";

const LABEL: Record<Priority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

const CLASSES: Record<Priority, string> = {
  low: "border-zinc-300 bg-zinc-50 text-zinc-700",
  normal: "border-border bg-card text-foreground",
  high: "border-amber-400 bg-amber-50 text-amber-900",
  urgent: "border-red-500 bg-red-50 text-red-900",
};

export function InstallationPrioritySelector({
  installationId,
  current,
  canEdit,
}: {
  installationId: string;
  current: Priority;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function change(next: Priority) {
    if (next === current) return;
    startTransition(async () => {
      const r = await setInstallationPriorityAction(installationId, next);
      if (!r.ok) {
        notify.error("No se pudo cambiar la prioridad", r.error);
        return;
      }
      notify.success(`Prioridad cambiada a ${LABEL[next]}`);
      router.refresh();
    });
  }

  if (!canEdit) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-xl border-2 px-2 py-0.5 text-xs font-bold ${CLASSES[current]}`}
      >
        {LABEL[current]}
      </span>
    );
  }

  return (
    <div className="relative inline-block">
      <select
        value={current}
        onChange={(e) => change(e.target.value as Priority)}
        disabled={pending}
        className={`h-8 cursor-pointer appearance-none rounded-xl border-2 pl-3 pr-7 text-xs font-bold ${CLASSES[current]} disabled:opacity-50`}
      >
        {(Object.keys(LABEL) as Priority[]).map((p) => (
          <option key={p} value={p}>
            {LABEL[p]}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-70" />
    </div>
  );
}
