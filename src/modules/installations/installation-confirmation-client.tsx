"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  CalendarClock,
  PhoneOff,
  Loader2,
  CheckCheck,
} from "lucide-react";
import {
  customerConfirmInstallationAction,
  customerRescheduleInstallationAction,
  customerPostponeInstallationAction,
} from "./public-confirmation-actions";

type View = "menu" | "reschedule" | "postpone" | "done";

interface Props {
  token: string;
  initialAction: string | null;
  scheduledAt: string;
}

export function InstallationConfirmationClient({
  token,
  initialAction,
  scheduledAt,
}: Props) {
  const initialView: View =
    initialAction === "reschedule"
      ? "reschedule"
      : initialAction === "postpone"
        ? "postpone"
        : "menu";
  const [view, setView] = useState<View>(initialView);
  const [doneMessage, setDoneMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const proposedNext = new Date(
    new Date(scheduledAt).getTime() + 3 * 86400_000,
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  const initialDate = `${proposedNext.getFullYear()}-${pad(
    proposedNext.getMonth() + 1,
  )}-${pad(proposedNext.getDate())}`;
  const [newDate, setNewDate] = useState(initialDate);
  const [newTime, setNewTime] = useState("10:00");
  const [reason, setReason] = useState("");

  function confirm() {
    setError("");
    startTransition(async () => {
      const r = await customerConfirmInstallationAction(token);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setDoneMessage(r.message);
      setView("done");
    });
  }

  function submitReschedule() {
    setError("");
    if (!newDate || !newTime) {
      setError("Elige día y hora");
      return;
    }
    const iso = new Date(`${newDate}T${newTime}:00`).toISOString();
    startTransition(async () => {
      const r = await customerRescheduleInstallationAction(token, iso);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setDoneMessage(r.message);
      setView("done");
    });
  }

  function submitPostpone() {
    setError("");
    startTransition(async () => {
      const r = await customerPostponeInstallationAction(
        token,
        reason || undefined,
      );
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setDoneMessage(r.message);
      setView("done");
    });
  }

  if (view === "done") {
    return (
      <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6 text-center">
        <CheckCheck className="mx-auto h-10 w-10 text-emerald-600" />
        <p className="mt-3 text-base font-bold text-emerald-900">{doneMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {view === "menu" && (
        <div className="grid gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-6 py-4 text-base font-bold text-white shadow-md hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
            Sí, me viene bien
          </button>
          <button
            type="button"
            onClick={() => setView("reschedule")}
            disabled={pending}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-sky-300 bg-white px-6 py-3 text-sm font-bold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
          >
            <CalendarClock className="h-4 w-4" />
            Elegir otra fecha
          </button>
          <button
            type="button"
            onClick={() => setView("postpone")}
            disabled={pending}
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-6 py-3 text-sm font-bold text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <PhoneOff className="h-4 w-4" />
            Posponer / llámame
          </button>
        </div>
      )}

      {view === "reschedule" && (
        <div className="space-y-3 rounded-xl border-2 border-sky-200 bg-sky-50/30 p-4">
          <p className="text-sm font-bold text-sky-900">
            Elige el día y la hora que mejor te venga:
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold">Día</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                min={new Date(Date.now() + 86400_000).toISOString().slice(0, 10)}
                className="h-11 w-full rounded-lg border border-input bg-white px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold">Hora</label>
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                min="09:00"
                max="19:00"
                className="h-11 w-full rounded-lg border border-input bg-white px-3 text-sm"
              />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Tu propuesta se enviará a nuestro equipo y te confirmaremos
            disponibilidad de técnico y ruta.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView("menu")}
              disabled={pending}
              className="flex-1 rounded-lg border border-border bg-white px-4 py-2 text-sm hover:bg-muted"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={submitReschedule}
              disabled={pending}
              className="flex-1 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {pending ? "Enviando…" : "Enviar propuesta"}
            </button>
          </div>
        </div>
      )}

      {view === "postpone" && (
        <div className="space-y-3 rounded-xl border-2 border-amber-200 bg-amber-50/40 p-4">
          <p className="text-sm font-bold text-amber-900">
            Cuéntanos brevemente el motivo (opcional):
          </p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Ej. estaré de viaje, prefiero retrasarlo unas semanas, etc."
            className="w-full rounded-lg border border-input bg-white p-2 text-sm"
            maxLength={500}
          />
          <p className="text-[11px] text-muted-foreground">
            Nos pondremos en contacto contigo lo antes posible para coordinar una
            nueva fecha.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView("menu")}
              disabled={pending}
              className="flex-1 rounded-lg border border-border bg-white px-4 py-2 text-sm hover:bg-muted"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={submitPostpone}
              disabled={pending}
              className="flex-1 rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {pending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
