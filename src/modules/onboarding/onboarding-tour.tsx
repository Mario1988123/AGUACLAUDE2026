"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, X, Check } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { markOnboardingDoneAction } from "./actions";
import type { OnboardingStep } from "./steps";

interface Props {
  steps: OnboardingStep[];
  /** Si true, monta el tour. Si false, no muestra nada (ya fue visto). */
  enabled: boolean;
}

/**
 * Tour de bienvenida sin librerías externas. Aparece como modal centrado
 * con steps numerados y persistencia local + remota: marca el flag al
 * acabar (o al saltar) para no volver a mostrarlo.
 */
export function OnboardingTour({ steps, enabled }: Props) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    // Pequeño delay para no chocar con el render inicial
    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [enabled]);

  function close(finished: boolean) {
    setOpen(false);
    startTransition(async () => {
      try {
        await markOnboardingDoneAction();
      } catch {
        /* fail-soft: si el server falla, mantenemos cerrado en cliente */
      }
    });
    if (finished && typeof window !== "undefined") {
      try {
        window.localStorage.setItem("onboarding.completed", "1");
      } catch {
        /* no-op */
      }
    }
  }

  if (!enabled || !open) return null;
  const step = steps[index];
  if (!step) return null;
  const Icon = step.icon;
  const isLast = index === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Bienvenido · Paso {index + 1} de {steps.length}
          </span>
          <button
            onClick={() => close(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Saltar tour"
            disabled={pending}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Icon className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-extrabold">{step.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
          {step.href && (
            <Link
              href={step.href as never}
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
              onClick={() => close(false)}
              prefetch={false}
            >
              Ir ahora →
            </Link>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-muted/20 px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0 || pending}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" /> Atrás
          </Button>
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"
                }`}
              />
            ))}
          </div>
          {isLast ? (
            <Button
              size="sm"
              variant="success"
              onClick={() => close(true)}
              disabled={pending}
              className="gap-1"
            >
              <Check className="h-4 w-4" /> Empezar
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}
              disabled={pending}
              className="gap-1"
            >
              Siguiente <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
