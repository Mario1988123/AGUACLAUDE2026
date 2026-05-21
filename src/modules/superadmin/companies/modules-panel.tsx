"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import { toggleCompanyModuleSafeAction } from "./actions";

interface ModuleEntry {
  key: string;
  label_es: string;
  description_es: string | null;
  is_core: boolean;
  is_parked: boolean;
  sort_order: number;
}

interface Props {
  companyId: string;
  modules: ModuleEntry[];
  activeMap: Record<string, boolean>;
}

export function CompanyModulesPanel({ companyId, modules, activeMap }: Props) {
  const [active, setActive] = useState<Record<string, boolean>>(activeMap);
  const [pending, startTransition] = useTransition();

  function handleToggle(key: string, isCore: boolean) {
    if (isCore) {
      notify.warning("Los módulos core no se pueden desactivar");
      return;
    }
    const next = !active[key];
    setActive((prev) => ({ ...prev, [key]: next }));
    startTransition(async () => {
      const r = await toggleCompanyModuleSafeAction(companyId, key, next);
      if (!r.ok) {
        notify.error("Error", r.error);
        setActive((prev) => ({ ...prev, [key]: !next }));
        return;
      }
      notify.success(`Módulo ${next ? "activado" : "desactivado"}`);
    });
  }

  return (
    <ul className="divide-y">
      {modules.map((m) => {
        const isActive = active[m.key] ?? false;
        return (
          <li key={m.key} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{m.label_es}</span>
                {m.is_core && <Badge variant="outline">core</Badge>}
                {m.is_parked && <Badge variant="secondary">aparcado</Badge>}
              </div>
              {m.description_es && (
                <p className="mt-1 text-xs text-muted-foreground">{m.description_es}</p>
              )}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              onClick={() => handleToggle(m.key, m.is_core)}
              disabled={pending || m.is_core}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                isActive ? "bg-primary" : "bg-muted"
              } ${m.is_core ? "opacity-50" : "cursor-pointer"}`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  isActive ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
