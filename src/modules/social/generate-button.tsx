"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { generateMonthlyPostsAction } from "./generate-action";

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

interface Props {
  defaultYear?: number;
  defaultMonth?: number;
}

export function GenerateMonthButton({ defaultYear, defaultMonth }: Props) {
  const now = new Date();
  const [year, setYear] = useState<number>(defaultYear ?? now.getFullYear());
  const [month, setMonth] = useState<number>(defaultMonth ?? now.getMonth() + 1);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run() {
    if (
      !confirm(
        `Generar borradores RRSS para ${MONTHS[month - 1]} ${year}?\n\nIdempotente: si ya hay posts del mes, no se duplican.`,
      )
    )
      return;
    startTransition(async () => {
      const r = await generateMonthlyPostsAction({ year, month });
      if (!r.ok) {
        notify.error("No se pudo generar", r.error);
        return;
      }
      notify.success(
        `Generado · ${r.posts_created} posts · ${r.ephemerides_used} efemérides`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card p-2">
      <select
        value={month}
        onChange={(e) => setMonth(Number(e.target.value))}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        disabled={pending}
      >
        {MONTHS.map((m, i) => (
          <option key={i} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select
        value={year}
        onChange={(e) => setYear(Number(e.target.value))}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        disabled={pending}
      >
        {[now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2].map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <Button onClick={run} disabled={pending} size="sm" className="gap-2">
        <Sparkles className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} />
        {pending ? "Generando…" : "Generar borradores"}
      </Button>
    </div>
  );
}
