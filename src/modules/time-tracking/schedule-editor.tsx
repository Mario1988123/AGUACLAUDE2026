"use client";

import { useEffect, useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { notify } from "@/shared/hooks/use-toast";
import {
  getUserSchedule,
  setUserScheduleSafeAction,
  type WorkScheduleDay,
} from "./schedule-actions";

const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function emptyWeek(): WorkScheduleDay[] {
  return WEEKDAYS.map((_, i) => ({
    day_of_week: i,
    starts_at: i < 5 ? "09:00" : null,
    ends_at: i < 5 ? "18:00" : null,
    break_minutes: i < 5 ? 60 : 0,
    expected_hours: i < 5 ? 8 : null,
  }));
}

export function ScheduleEditor({ users }: { users: Array<{ id: string; name: string }> }) {
  const [userId, setUserId] = useState("");
  const [days, setDays] = useState<WorkScheduleDay[]>(emptyWeek());
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      setDays(emptyWeek());
      return;
    }
    setLoading(true);
    getUserSchedule(userId)
      .then((rows) => {
        const week = emptyWeek();
        for (const r of rows) {
          week[r.day_of_week] = r;
        }
        setDays(week);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  function update(i: number, patch: Partial<WorkScheduleDay>) {
    setDays((cur) => cur.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function save() {
    if (!userId) {
      notify.warning("Elige un usuario");
      return;
    }
    startTransition(async () => {
      const r = await setUserScheduleSafeAction(userId, days);
      if (!r.ok) {
        notify.error("Error", r.error);
        return;
      }
      notify.success("Horario guardado");
    });
  }

  return (
    <div className="space-y-4">
      <select
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
        className="h-12 w-full rounded-xl border border-input bg-background px-3 text-base"
      >
        <option value="">— Elige usuario —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>

      {userId && !loading && (
        <>
          <div className="space-y-2">
            {days.map((d, i) => (
              <div
                key={i}
                className="grid grid-cols-12 items-end gap-2 rounded-xl border bg-background p-3"
              >
                <div className="col-span-12 sm:col-span-2 font-semibold">{WEEKDAYS[i]}</div>
                <div className="col-span-4 sm:col-span-2">
                  <Input
                    type="time"
                    value={d.starts_at ?? ""}
                    onChange={(e) => update(i, { starts_at: e.target.value || null })}
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Input
                    type="time"
                    value={d.ends_at ?? ""}
                    onChange={(e) => update(i, { ends_at: e.target.value || null })}
                  />
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <label className="text-xs text-muted-foreground">Descanso (min)</label>
                  <Input
                    type="number"
                    min={0}
                    value={d.break_minutes}
                    onChange={(e) => update(i, { break_minutes: Number(e.target.value) })}
                  />
                </div>
                <div className="col-span-12 sm:col-span-2">
                  <label className="text-xs text-muted-foreground">Horas esperadas</label>
                  <Input
                    type="number"
                    step="0.25"
                    min={0}
                    value={d.expected_hours ?? ""}
                    onChange={(e) =>
                      update(i, {
                        expected_hours: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </div>
                <div className="col-span-12 sm:col-span-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      update(i, { starts_at: null, ends_at: null, break_minutes: 0, expected_hours: null })
                    }
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Limpiar
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button onClick={save} disabled={pending} variant="success" className="gap-2">
              <Save className="h-4 w-4" /> {pending ? "Guardando…" : "Guardar horario"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
