"use client";

import { useEffect, useRef } from "react";
import { notify } from "@/shared/hooks/use-toast";
import {
  getMyActiveNotificationsForSubject,
  markNotificationReadAction,
} from "./subject-actions";

interface Props {
  subjectType: string;
  subjectId: string;
}

/**
 * Componente invisible que, al montarse en una página destino (p.ej.
 * /incidencias/[id]), busca notificaciones activas del usuario para ese
 * subject y las muestra como toast emergente. Cada notificación mostrada
 * se marca automáticamente como leída para que no vuelva a aparecer.
 *
 * Si entre tanto la entidad se resolvió, las notificaciones quedaron
 * marcadas con auto_resolved_at en BD por la action que la cerró, y
 * esta query no las recoge: el toast no aparece y la campana también
 * descontará el badge.
 */
export function SubjectNotificationToast({ subjectType, subjectId }: Props) {
  const shownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const notifs = await getMyActiveNotificationsForSubject(
          subjectType,
          subjectId,
        );
        if (cancelled) return;
        for (const n of notifs) {
          if (shownRef.current.has(n.id)) continue;
          shownRef.current.add(n.id);
          const showFn =
            n.severity === "error"
              ? notify.error
              : n.severity === "warning"
                ? notify.warning
                : n.severity === "success"
                  ? notify.success
                  : notify.info;
          showFn(n.title, n.body ?? undefined);
          // Marcamos como leída para que no se repita en próximas
          // visitas. Si la pestaña sigue abierta, el shownRef.current
          // ya evita repetir en esta sesión.
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

  return null;
}
