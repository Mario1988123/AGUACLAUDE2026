"use client";

import { useEffect, useState } from "react";
import { X, Info, CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";
import {
  getMyActiveNotificationsForSubject,
  markNotificationReadAction,
  type SubjectNotification,
} from "./subject-actions";

interface Props {
  subjectType: string;
  subjectId: string;
}

/**
 * Modal emergente bloqueante que muestra las notificaciones activas
 * del usuario para un subject al cargar la página. Antes era un toast
 * que pasaba desapercibido — ahora es un modal que el usuario debe
 * cerrar explícitamente.
 *
 * Si entre tanto la entidad se resolvió, las notificaciones quedaron
 * marcadas con auto_resolved_at por la action correspondiente y este
 * componente no las recoge.
 */
export function SubjectNotificationToast({ subjectType, subjectId }: Props) {
  const [items, setItems] = useState<SubjectNotification[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const notifs = await getMyActiveNotificationsForSubject(
          subjectType,
          subjectId,
        );
        if (cancelled) return;
        setItems(notifs);
        // Marcar como leídas en BD para que no se repita en próximas
        // visitas (el usuario ya las ve en el modal aquí mismo).
        for (const n of notifs) {
          void markNotificationReadAction(n.id);
        }
      } catch {
        /* no-op */
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [subjectType, subjectId]);

  if (items.length === 0) return null;

  function dismiss(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
  }

  function dismissAll() {
    setItems([]);
  }

  // Color e icono según severidad de la primera (la más reciente)
  const top = items[0]!;
  const palette =
    top.severity === "error"
      ? {
          bg: "bg-red-50",
          border: "border-red-300",
          text: "text-red-900",
          accent: "text-red-700",
          Icon: AlertCircle,
        }
      : top.severity === "warning"
        ? {
            bg: "bg-amber-50",
            border: "border-amber-300",
            text: "text-amber-900",
            accent: "text-amber-700",
            Icon: AlertTriangle,
          }
        : top.severity === "success"
          ? {
              bg: "bg-emerald-50",
              border: "border-emerald-300",
              text: "text-emerald-900",
              accent: "text-emerald-700",
              Icon: CheckCircle2,
            }
          : {
              bg: "bg-blue-50",
              border: "border-blue-300",
              text: "text-blue-900",
              accent: "text-blue-700",
              Icon: Info,
            };

  const Icon = palette.Icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`flex max-h-[90vh] w-full max-w-md flex-col rounded-2xl border-2 ${palette.border} ${palette.bg} shadow-2xl`}
      >
        <div
          className={`flex items-center justify-between border-b ${palette.border} p-4`}
        >
          <div className={`flex items-center gap-2 font-bold ${palette.text}`}>
            <Icon className="h-5 w-5" />
            <span>
              {items.length === 1
                ? "Aviso pendiente"
                : `${items.length} avisos pendientes`}
            </span>
          </div>
          <button
            type="button"
            onClick={dismissAll}
            className={`rounded-full p-1.5 hover:bg-white/40 ${palette.accent}`}
            aria-label="Cerrar todos"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="flex-1 divide-y divide-black/10 overflow-y-auto">
          {items.map((n) => (
            <li key={n.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className={`text-sm font-bold ${palette.text}`}>
                    {n.title}
                  </h3>
                  {n.body && (
                    <p className={`mt-1 text-sm ${palette.accent}`}>{n.body}</p>
                  )}
                  <p className={`mt-1 text-[11px] ${palette.accent} opacity-70`}>
                    {new Date(n.created_at).toLocaleString("es-ES")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(n.id)}
                  className={`shrink-0 rounded-full p-1 hover:bg-white/40 ${palette.accent}`}
                  aria-label="Cerrar"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className={`border-t ${palette.border} bg-white/40 p-3`}>
          <button
            type="button"
            onClick={dismissAll}
            className={`w-full rounded-xl border-2 ${palette.border} bg-white py-2 text-sm font-bold ${palette.text} hover:bg-white/80`}
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
