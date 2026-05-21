"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { saveExpenseSettingsSafeAction, type ExpenseSettings } from "./actions";

export function ExpenseSettingsForm({ initial }: { initial: ExpenseSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState({
    per_diem_overnight_eur: (initial.per_diem_overnight_cents / 100).toFixed(2),
    per_diem_no_overnight_eur: (initial.per_diem_no_overnight_cents / 100).toFixed(2),
    per_diem_eu_overnight_eur: (initial.per_diem_eu_overnight_cents / 100).toFixed(2),
    per_diem_eu_no_overnight_eur: (initial.per_diem_eu_no_overnight_cents / 100).toFixed(2),
    km_rate_eur: (initial.km_rate_cents / 100).toFixed(2),
    daily_meal_alert_eur: (initial.daily_meal_alert_cents / 100).toFixed(2),
    require_client_link_above_eur: (initial.require_client_link_above_cents / 100).toFixed(2),
  });

  function toCents(v: string): number {
    const n = Number(v.replace(",", "."));
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  function save() {
    startTransition(async () => {
      const r = await saveExpenseSettingsSafeAction({
        per_diem_overnight_cents: toCents(form.per_diem_overnight_eur),
        per_diem_no_overnight_cents: toCents(form.per_diem_no_overnight_eur),
        per_diem_eu_overnight_cents: toCents(form.per_diem_eu_overnight_eur),
        per_diem_eu_no_overnight_cents: toCents(form.per_diem_eu_no_overnight_eur),
        km_rate_cents: toCents(form.km_rate_eur),
        daily_meal_alert_cents: toCents(form.daily_meal_alert_eur),
        require_client_link_above_cents: toCents(form.require_client_link_above_eur),
      });
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Guardado");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Dietas (RD 439/2007)
        </h3>
        <p className="text-xs text-muted-foreground">
          Importes diarios exentos de IRPF. Si pasas estos importes, lo que excede tributa.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Manutención CON pernocta · nacional (€/día)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.per_diem_overnight_eur}
              onChange={(e) => setForm({ ...form, per_diem_overnight_eur: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Manutención SIN pernocta · nacional (€/día)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.per_diem_no_overnight_eur}
              onChange={(e) => setForm({ ...form, per_diem_no_overnight_eur: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Manutención CON pernocta · UE/extranjero (€/día)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.per_diem_eu_overnight_eur}
              onChange={(e) => setForm({ ...form, per_diem_eu_overnight_eur: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Manutención SIN pernocta · UE/extranjero (€/día)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.per_diem_eu_no_overnight_eur}
              onChange={(e) => setForm({ ...form, per_diem_eu_no_overnight_eur: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Kilometraje
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Importe €/km (límite IRPF España: 0,26)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.km_rate_eur}
              onChange={(e) => setForm({ ...form, km_rate_eur: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Alertas
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Alertar comida del comercial &gt; (€)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.daily_meal_alert_eur}
              onChange={(e) => setForm({ ...form, daily_meal_alert_eur: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Pedir cliente asociado si gasto &gt; (€)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.require_client_link_above_eur}
              onChange={(e) =>
                setForm({ ...form, require_client_link_above_eur: e.target.value })
              }
            />
          </div>
        </div>
      </div>

      <Button onClick={save} disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  );
}
