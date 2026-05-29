"use client";

import { useEffect, useState, useTransition } from "react";
import {
  CheckCircle2,
  CalendarClock,
  PhoneOff,
  Loader2,
  CheckCheck,
  Sun,
  Moon,
  Route,
} from "lucide-react";
import {
  customerConfirmAction,
  customerReconfirmAction,
  customerRescheduleAction,
  customerPostponeAction,
  getMaintenanceOfferableSlots,
} from "./public-confirmation-actions";
import type { OfferableResult, Slot } from "@/modules/scheduling/availability";

type View = "menu" | "reschedule" | "postpone" | "done";

interface Props {
  token: string;
  isDayBefore: boolean;
  initialAction: string | null;
  scheduledAt: string;
}

function dateLabel(ymd: string): string {
  const parts = ymd.split("-");
  const y = Number(parts[0]) || new Date().getFullYear();
  const m = Number(parts[1]) || 1;
  const d = Number(parts[2]) || 1;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function ConfirmationClient({ token, isDayBefore, initialAction }: Props) {
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
  const [reason, setReason] = useState("");

  const [offer, setOffer] = useState<OfferableResult | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [sel, setSel] = useState<{ date: string; slot: Slot } | null>(null);

  useEffect(() => {
    if (view !== "reschedule" || offer) return;
    setLoadingSlots(true);
    getMaintenanceOfferableSlots(token)
      .then((r) => setOffer(r))
      .catch(() => setOffer(null))
      .finally(() => setLoadingSlots(false));
  }, [view, token, offer]);

  function confirm() {
    setError("");
    startTransition(async () => {
      const r = isDayBefore
        ? await customerReconfirmAction(token)
        : await customerConfirmAction(token);
      if (!r.ok) return setError(r.message);
      setDoneMessage(r.message);
      setView("done");
    });
  }

  function submitReschedule() {
    setError("");
    if (!sel) return setError("Elige una fecha y franja de las disponibles");
    startTransition(async () => {
      const r = await customerRescheduleAction(token, sel.date, sel.slot);
      if (!r.ok) return setError(r.message);
      setDoneMessage(r.message);
      setView("done");
    });
  }

  function submitPostpone() {
    setError("");
    startTransition(async () => {
      const r = await customerPostponeAction(token, reason || undefined);
      if (!r.ok) return setError(r.message);
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
            {isDayBefore ? "Sí, perfecto, nos vemos" : "Sí, lo confirmo"}
          </button>
          {!isDayBefore && (
            <button
              type="button"
              onClick={() => setView("reschedule")}
              disabled={pending}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-sky-300 bg-white px-6 py-3 text-sm font-bold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
            >
              <CalendarClock className="h-4 w-4" />
              Elegir otra fecha
            </button>
          )}
          <button
            type="button"
            onClick={() => setView("postpone")}
            disabled={pending}
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-white px-6 py-3 text-sm font-bold text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            <PhoneOff className="h-4 w-4" />
            {isDayBefore ? "No puedo, posponer" : "Posponer / llámame"}
          </button>
        </div>
      )}

      {view === "reschedule" && (
        <div className="space-y-3 rounded-xl border-2 border-sky-200 bg-sky-50/30 p-4">
          <p className="text-sm font-bold text-sky-900">
            Elige una de las fechas disponibles:
          </p>

          {loadingSlots && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando huecos disponibles…
            </div>
          )}

          {!loadingSlots && offer && offer.slots.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Ahora mismo no tenemos huecos online para tu zona. Pulsa
              &quot;Posponer / llámame&quot; y te buscamos hueco por teléfono.
            </div>
          )}

          {!loadingSlots && offer && offer.slots.length > 0 && (
            <div className="space-y-2">
              {offer.slots.map((s) => (
                <div
                  key={s.date}
                  className="rounded-lg border border-sky-200 bg-white p-3"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold capitalize text-sky-950">
                      {dateLabel(s.date)}
                    </span>
                    {s.reason === "route" && s.km != null && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                        <Route className="h-3 w-3" />
                        ruta cercana
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {s.slots.map((slot) => {
                      const active = sel?.date === s.date && sel?.slot === slot;
                      return (
                        <button
                          key={slot}
                          type="button"
                          onClick={() => setSel({ date: s.date, slot })}
                          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-bold transition ${
                            active
                              ? "border-sky-600 bg-sky-600 text-white"
                              : "border-sky-200 bg-white text-sky-700 hover:bg-sky-50"
                          }`}
                        >
                          {slot === "morning" ? (
                            <Sun className="h-4 w-4" />
                          ) : (
                            <Moon className="h-4 w-4" />
                          )}
                          {slot === "morning" ? "Mañana" : "Tarde"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
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
              disabled={pending || !sel}
              className="flex-1 rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {pending ? "Enviando…" : "Confirmar esta fecha"}
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
            placeholder="Ej. estaré de viaje, prefiero retrasarlo unos meses, etc."
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
