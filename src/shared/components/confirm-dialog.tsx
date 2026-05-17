"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/shared/ui/button";

type Variant = "default" | "destructive" | "warning" | "success";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: Variant;
}

type Resolver = (value: boolean) => void;

interface Ctx {
  ask: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmCtx = createContext<Ctx | null>(null);

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<Resolver | null>(null);

  const ask = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((value: boolean) => {
    setOpen(false);
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r(value);
  }, []);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <ConfirmCtx.Provider value={{ ask }}>
      {children}
      {open && opts && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-2 sm:p-4"
          onClick={() => close(false)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex flex-1 items-start gap-3 overflow-y-auto p-5">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  opts.variant === "destructive"
                    ? "bg-destructive/10 text-destructive"
                    : opts.variant === "warning"
                      ? "bg-amber-100 text-amber-700"
                      : opts.variant === "success"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-primary/10 text-primary"
                }`}
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold">{opts.title ?? "¿Confirmar?"}</h2>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {opts.message}
                </p>
              </div>
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t bg-muted/20 p-3">
              <Button variant="outline" onClick={() => close(false)}>
                {opts.cancelText ?? "Cancelar"}
              </Button>
              <Button
                variant={
                  opts.variant === "destructive"
                    ? "destructive"
                    : opts.variant === "success"
                      ? "success"
                      : opts.variant === "warning"
                        ? "warning"
                        : "default"
                }
                onClick={() => close(true)}
                autoFocus
              >
                {opts.confirmText ?? "Aceptar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) {
    // Fallback: si no está montado el provider, caemos al confirm nativo
    return async (opts: ConfirmOptions) => {
      if (typeof window === "undefined") return false;
      return window.confirm(`${opts.title ?? ""}${opts.title ? "\n\n" : ""}${opts.message}`);
    };
  }
  return ctx.ask;
}
