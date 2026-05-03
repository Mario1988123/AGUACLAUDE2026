"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import { setVacationDaysAction, type VacationBalance } from "./schedule-actions";

export function VacationsTable({ balances, year }: { balances: VacationBalance[]; year: number }) {
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function save(userId: string) {
    const days = edits[userId];
    if (days == null || days < 0) return;
    startTransition(async () => {
      try {
        await setVacationDaysAction(userId, year, days);
        notify.success("Saldo guardado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="py-2">Usuario</th>
            <th className="py-2 text-right">Disponibles</th>
            <th className="py-2 text-right">Disfrutados</th>
            <th className="py-2 text-right">Restantes</th>
            <th className="py-2 text-right">Acción</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => {
            const cur = edits[b.user_id] ?? b.days_total;
            return (
              <tr key={b.user_id} className="border-b last:border-0">
                <td className="py-2 font-semibold">{b.user_name}</td>
                <td className="py-2 text-right">
                  <Input
                    type="number"
                    min={0}
                    value={cur}
                    onChange={(e) =>
                      setEdits((m) => ({ ...m, [b.user_id]: Number(e.target.value) }))
                    }
                    className="ml-auto h-9 w-20 text-right"
                  />
                </td>
                <td className="py-2 text-right tabular-nums">{b.days_taken}</td>
                <td
                  className={`py-2 text-right tabular-nums font-semibold ${
                    b.days_remaining > 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {b.days_remaining}
                </td>
                <td className="py-2 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => save(b.user_id)}
                    disabled={pending || cur === b.days_total}
                    className="gap-1"
                  >
                    <Save className="h-3 w-3" /> Guardar
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
