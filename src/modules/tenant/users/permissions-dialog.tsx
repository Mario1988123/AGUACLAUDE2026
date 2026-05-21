"use client";

import { useEffect, useState, useTransition } from "react";
import { Shield } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import { MODULES } from "@/shared/lib/modules";
import {
  getUserModuleOverrides,
  setUserModuleOverrideSafeAction,
} from "./permissions-actions";

type State = "default" | "granted" | "denied";

const STATE_LABEL: Record<State, string> = {
  default: "Por rol",
  granted: "Forzar acceso",
  denied: "Forzar denegado",
};

export function UserPermissionsButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getUserModuleOverrides(userId)
      .then((rows) => {
        const map: Record<string, boolean> = {};
        rows.forEach((r) => (map[r.module_key] = r.granted));
        setOverrides(map);
      })
      .finally(() => setLoading(false));
  }, [open, userId]);

  function setState(moduleKey: string, state: State) {
    startTransition(async () => {
      const granted = state === "default" ? null : state === "granted";
      const r = await setUserModuleOverrideSafeAction(userId, moduleKey, granted);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      setOverrides((cur) => {
        const next = { ...cur };
        if (state === "default") delete next[moduleKey];
        else next[moduleKey] = granted!;
        return next;
      });
    });
  }

  function getState(moduleKey: string): State {
    if (!(moduleKey in overrides)) return "default";
    return overrides[moduleKey] ? "granted" : "denied";
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        aria-label="Permisos por módulo"
        title="Permisos por módulo"
      >
        <Shield className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Permisos por módulo</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Por defecto cada usuario ve los módulos según sus roles. Aquí puedes forzar acceso o
            denegarlo a un módulo concreto.
          </p>
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto space-y-1.5">
              {MODULES.map((m) => {
                const cur = getState(m.key);
                return (
                  <div
                    key={m.key}
                    className="flex items-center justify-between gap-3 rounded-xl border p-2.5"
                  >
                    <span className="text-sm font-semibold">{m.label}</span>
                    <div className="flex gap-1">
                      {(["default", "granted", "denied"] as State[]).map((s) => (
                        <button
                          key={s}
                          onClick={() => setState(m.key, s)}
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${
                            cur === s
                              ? s === "granted"
                                ? "bg-emerald-600 text-white"
                                : s === "denied"
                                  ? "bg-red-600 text-white"
                                  : "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground hover:bg-muted/70"
                          }`}
                        >
                          {STATE_LABEL[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-end border-t pt-3">
            <Button onClick={() => setOpen(false)}>Cerrar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
