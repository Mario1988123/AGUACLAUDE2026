"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Pause } from "lucide-react";
import * as Icons from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { toggleCompanyModuleSafeAction, type ModuleRow } from "./actions";

export function ModulesManager({ modules }: { modules: ModuleRow[] }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(m: ModuleRow) {
    if (m.is_core) {
      notify.warning("Este módulo es esencial y no puede desactivarse");
      return;
    }
    startTransition(async () => {
      const r = await toggleCompanyModuleSafeAction(m.key, !m.is_active);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success(m.is_active ? "Módulo desactivado" : "Módulo activado");
      router.refresh();
    });
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {modules.map((m) => {
        const Icon =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
            m.icon ?? ""
          ] ?? Icons.Square;
        return (
          <li
            key={m.key}
            className={`flex items-start gap-3 rounded-2xl border-2 p-4 transition-colors ${
              m.is_active
                ? "border-primary/40 bg-primary/5"
                : "border-border bg-card opacity-70"
            }`}
          >
            <div
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                m.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.label_es}</span>
                {m.is_core && (
                  <Badge variant="secondary" className="gap-1">
                    <Lock className="h-3 w-3" /> Core
                  </Badge>
                )}
                {m.is_parked && (
                  <Badge variant="outline" className="gap-1">
                    <Pause className="h-3 w-3" /> Aparcado
                  </Badge>
                )}
              </div>
              {m.description_es && (
                <p className="mt-1 text-xs text-muted-foreground">{m.description_es}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => toggle(m)}
              disabled={pending || m.is_core || m.is_parked}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                m.is_active ? "bg-success" : "bg-muted"
              } ${m.is_core || m.is_parked ? "opacity-50" : ""}`}
              aria-label={m.is_active ? "Desactivar" : "Activar"}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  m.is_active ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
