"use client";

import { useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card, CardContent } from "@/shared/ui/card";
import { notify } from "@/shared/hooks/use-toast";
import { createAgendaEventSafeAction, type AgendaSubjectHit } from "./actions";
import { SubjectPickerModal } from "./subject-picker-modal";
import { AGENDA_KIND } from "./schemas";
import { KIND_LABEL } from "./constants";
import { Plus, X, Search } from "lucide-react";

interface Props {
  teamMembers?: { user_id: string; full_name: string }[];
  /** Si se pasa, la tarea queda vinculada a este cliente/lead y el selector
   *  se muestra fijo (no se puede cambiar). Lo usa el botón "Agendar" de la
   *  ficha de lead. */
  presetSubject?: { type: "customer" | "lead"; id: string; label: string };
  /** Título sugerido al abrir (ej. "Visita comercial"). */
  presetTitle?: string;
  /** Texto del botón que abre el formulario. */
  triggerLabel?: string;
  /** Clases extra del botón disparador (para encajar en barras de la ficha). */
  triggerClassName?: string;
  /** Variante visual del botón disparador. */
  triggerVariant?: "default" | "outline" | "success";
}

const emptyForm = (presetTitle?: string) => ({
  kind: "manual" as (typeof AGENDA_KIND)[number],
  title: presetTitle ?? "",
  description: "",
  starts_at: "",
  ends_at: "",
  assigned_user_id: "",
  recurrence_freq: "none" as "none" | "daily" | "weekly" | "monthly",
  recurrence_count: 1,
});

export function CreateAgendaButton({
  teamMembers = [],
  presetSubject,
  presetTitle,
  triggerLabel = "Nuevo evento",
  triggerClassName,
  triggerVariant = "default",
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState(emptyForm(presetTitle));

  // Cliente/lead vinculado a la tarea.
  const presetHit: AgendaSubjectHit | null = presetSubject
    ? {
        subject_type: presetSubject.type,
        subject_id: presetSubject.id,
        label: presetSubject.label,
        sublabel: null,
      }
    : null;
  const [subject, setSubject] = useState<AgendaSubjectHit | null>(presetHit);
  const [pickerOpen, setPickerOpen] = useState(false);

  function resetAll() {
    setForm(emptyForm(presetTitle));
    setSubject(presetHit);
    setPickerOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await createAgendaEventSafeAction({
        kind: form.kind,
        title: form.title,
        description: form.description,
        starts_at: form.starts_at,
        ends_at: form.ends_at,
        assigned_user_id: form.assigned_user_id || undefined,
        subject_type: subject?.subject_type,
        subject_id: subject?.subject_id,
        recurrence_freq: form.recurrence_freq,
        recurrence_count: form.recurrence_count,
      });
      if (!r.ok) {
        notify.error("No se pudo agendar", r.error);
        return;
      }
      notify.success("Evento agendado");
      resetAll();
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <Button
        variant={triggerVariant}
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        <Plus className="h-4 w-4" /> {triggerLabel}
      </Button>
    );
  }

  return (
    <>
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kind">Tipo</Label>
              <select
                id="kind"
                value={form.kind}
                onChange={(e) =>
                  setForm({ ...form, kind: e.target.value as (typeof AGENDA_KIND)[number] })
                }
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                {AGENDA_KIND.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k] ?? k}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="assigned">Asignado a</Label>
              <select
                id="assigned"
                value={form.assigned_user_id}
                onChange={(e) => setForm({ ...form, assigned_user_id: e.target.value })}
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                <option value="">Yo mismo</option>
                {teamMembers.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Cliente o lead vinculado a la tarea */}
          <div className="space-y-1.5">
            <Label>Cliente o lead</Label>
            {subject ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold uppercase text-primary">
                    {subject.subject_type === "customer" ? "Cliente" : "Lead"}
                  </span>
                  <span className="truncate font-medium">{subject.label}</span>
                  {subject.sublabel && (
                    <span className="truncate text-xs text-muted-foreground">
                      · {subject.sublabel}
                    </span>
                  )}
                </span>
                {!presetSubject && (
                  <button
                    type="button"
                    onClick={() => setSubject(null)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label="Quitar"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ) : (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => setPickerOpen(true)}
                >
                  <Search className="h-4 w-4" /> Buscar cliente o lead…
                </Button>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Opcional. Abre el listado completo (clientes o leads), filtra por
                  nombre o teléfono y elige.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Título *</Label>
            <Input
              id="title"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Visita comercial, llamada de seguimiento..."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="starts_at">Inicio *</Label>
              <Input
                id="starts_at"
                type="datetime-local"
                required
                value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ends_at">Fin</Label>
              <Input
                id="ends_at"
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Notas</Label>
            <textarea
              id="description"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full rounded-xl border border-border bg-card p-3 text-sm"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="recurrence_freq">Repetir</Label>
              <select
                id="recurrence_freq"
                value={form.recurrence_freq}
                onChange={(e) =>
                  setForm({
                    ...form,
                    recurrence_freq: e.target.value as typeof form.recurrence_freq,
                  })
                }
                className="flex h-12 w-full rounded-xl border border-border bg-card px-4 text-base"
              >
                <option value="none">Sin repetición</option>
                <option value="daily">Diariamente</option>
                <option value="weekly">Semanalmente</option>
                <option value="monthly">Mensualmente</option>
              </select>
            </div>
            {form.recurrence_freq !== "none" && (
              <div className="space-y-1.5">
                <Label htmlFor="recurrence_count">Nº de repeticiones</Label>
                <Input
                  id="recurrence_count"
                  type="number"
                  min={1}
                  max={52}
                  value={form.recurrence_count}
                  onChange={(e) =>
                    setForm({ ...form, recurrence_count: Number(e.target.value) })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Se crearán {form.recurrence_count} eventos en total.
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetAll();
                setOpen(false);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando..." : "Crear evento"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
    <SubjectPickerModal
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      onSelect={(hit) => setSubject(hit)}
    />
    </>
  );
}
