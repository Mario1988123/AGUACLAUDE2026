"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Calendar,
  Clock,
  ExternalLink,
  Save,
  User,
  UserCog,
  AlertTriangle,
  Tag,
  MapPin,
  Navigation,
  Phone,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { notify } from "@/shared/hooks/use-toast";
import {
  rescheduleAgendaEventSafeAction,
  reassignAgendaEventSafeAction,
} from "./actions";
import { KIND_LABEL, STATUS_LABEL, STATUS_VARIANT } from "./constants";
import type { AgendaItem } from "./actions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Compatibilidad con la firma antigua (solo id) */
  eventId?: string;
  currentStartsAt?: string;
  eventTitle?: string;
  /** Nueva firma: pasa el evento entero para mostrar todos los detalles */
  event?: AgendaItem;
  /** Lista de usuarios para reasignar (solo se permite a nivel 1-2) */
  team?: { user_id: string; full_name: string }[];
  canReassign?: boolean;
  /** Mapa de user_id → nombre para mostrar el actual */
  userNameMap?: Map<string, string>;
}

const SUBJECT_LINK: Record<string, string> = {
  installation: "/instalaciones",
  maintenance: "/mantenimientos",
  contract: "/contratos",
  proposal: "/propuestas",
  lead: "/leads",
  customer: "/clientes",
  incident: "/incidencias",
  free_trial: "/pruebas-gratuitas",
};

// Etiqueta en español de cada tipo (antes se mostraba el valor crudo en inglés,
// p.ej. "Ver customer"/"Ver lead").
const SUBJECT_LABEL_ES: Record<string, string> = {
  installation: "instalación",
  maintenance: "mantenimiento",
  contract: "contrato",
  proposal: "propuesta",
  lead: "lead",
  customer: "cliente",
  incident: "incidencia",
  free_trial: "prueba gratuita",
};

export function MoveEventDialog({
  open,
  onOpenChange,
  eventId: legacyId,
  currentStartsAt: legacyStartsAt,
  eventTitle: legacyTitle,
  event,
  team = [],
  canReassign = false,
  userNameMap,
}: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const ev: AgendaItem | null =
    event ??
    (legacyId && legacyStartsAt
      ? {
          id: legacyId,
          kind: "manual",
          status: "scheduled",
          title: legacyTitle ?? "",
          description: null,
          starts_at: legacyStartsAt,
          ends_at: null,
          assigned_user_id: null,
          is_outside_hours: false,
          subject_type: null,
          subject_id: null,
        }
      : null);

  function fmtDate(iso: string) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function fmtTime(iso: string) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  const [date, setDate] = useState(ev ? fmtDate(ev.starts_at) : "");
  const [time, setTime] = useState(ev ? fmtTime(ev.starts_at) : "");
  const [newAssigned, setNewAssigned] = useState<string>(ev?.assigned_user_id ?? "");

  useEffect(() => {
    if (open && ev) {
      setDate(fmtDate(ev.starts_at));
      setTime(fmtTime(ev.starts_at));
      setNewAssigned(ev.assigned_user_id ?? "");
    }
  }, [open, ev]);

  function saveReschedule() {
    if (!ev) return;
    if (!date || !time) {
      notify.warning("Indica fecha y hora");
      return;
    }
    const [y, m, d] = date.split("-").map(Number);
    const [hh, mm] = time.split(":").map(Number);
    const newDate = new Date(y!, (m ?? 1) - 1, d!, hh ?? 0, mm ?? 0, 0);
    startTransition(async () => {
      const r = await rescheduleAgendaEventSafeAction(
        ev.id,
        newDate.toISOString(),
      );
      if (!r.ok) {
        notify.error("No se pudo reagendar", r.error);
        return;
      }
      notify.success("Evento reagendado");
      onOpenChange(false);
      router.refresh();
    });
  }

  function saveReassign() {
    if (!ev) return;
    if (!newAssigned || newAssigned === ev.assigned_user_id) {
      notify.warning("Elige un usuario distinto al actual");
      return;
    }
    startTransition(async () => {
      const r = await reassignAgendaEventSafeAction(ev.id, newAssigned);
      if (!r.ok) {
        notify.error("No se pudo reasignar", r.error);
        return;
      }
      notify.success("Tarea reasignada");
      onOpenChange(false);
      router.refresh();
    });
  }

  if (!ev) return null;

  const subjectHref =
    ev.subject_type && ev.subject_id && SUBJECT_LINK[ev.subject_type]
      ? `${SUBJECT_LINK[ev.subject_type]}/${ev.subject_id}`
      : null;
  const assignedName = ev.assigned_user_id
    ? userNameMap?.get(ev.assigned_user_id) ?? "—"
    : "Sin asignar";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ev.title || "Tarea"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Resumen del evento */}
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                <Tag className="h-3 w-3" /> {KIND_LABEL[ev.kind] ?? ev.kind}
              </Badge>
              <Badge variant={STATUS_VARIANT[ev.status]}>
                {STATUS_LABEL[ev.status] ?? ev.status}
              </Badge>
              {ev.is_outside_hours && (
                <Badge variant="warning">
                  <AlertTriangle className="h-3 w-3" /> Fuera de horario
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {new Date(ev.starts_at).toLocaleDateString("es-ES", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              <Clock className="ml-2 h-3 w-3" />
              {new Date(ev.starts_at).toLocaleTimeString("es-ES", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {ev.ends_at && (
                <>
                  {" – "}
                  {new Date(ev.ends_at).toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <User className="h-3 w-3" /> Asignado a: <strong>{assignedName}</strong>
            </div>
            {ev.description && (
              <p className="whitespace-pre-wrap pt-1 text-xs text-foreground/80">
                {ev.description}
              </p>
            )}
            {/* Dirección de instalación + Google Maps + contacto, para que el
                instalador no dependa de abrir la ficha (que su rol puede no
                permitirle: daba 404). */}
            {(ev.subject_address ||
              (ev.subject_lat != null && ev.subject_lng != null) ||
              ev.subject_phone) && (
              <div className="space-y-1.5 border-t pt-2">
                {ev.subject_address && (
                  <div className="flex items-start gap-1.5 text-xs">
                    <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    <span>{ev.subject_address}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {((ev.subject_lat != null && ev.subject_lng != null) ||
                    ev.subject_address) && (
                    <a
                      href={
                        ev.subject_lat != null && ev.subject_lng != null
                          ? `https://www.google.com/maps/dir/?api=1&destination=${ev.subject_lat},${ev.subject_lng}`
                          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.subject_address ?? "")}`
                      }
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
                    >
                      <Navigation className="h-3.5 w-3.5" /> Ir con Google Maps
                    </a>
                  )}
                  {ev.subject_phone && (
                    <>
                      <a
                        href={`tel:${ev.subject_phone}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                      >
                        <Phone className="h-3.5 w-3.5" /> Llamar
                      </a>
                      <a
                        href={`https://wa.me/${ev.subject_phone.replace(/[^0-9+]/g, "")}`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </a>
                    </>
                  )}
                </div>
              </div>
            )}
            {subjectHref && (
              <Link
                href={subjectHref as never}
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Ver{" "}
                {ev.subject_type
                  ? SUBJECT_LABEL_ES[ev.subject_type] ?? ev.subject_type
                  : "ficha"}
              </Link>
            )}
          </div>

          {/* Reagendar */}
          <div className="space-y-2 rounded-xl border border-border bg-card p-3">
            <h3 className="text-sm font-bold">Reagendar</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Nueva fecha</Label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Nueva hora</Label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={saveReschedule} disabled={pending}>
                <Save className="h-3 w-3" /> Reagendar
              </Button>
            </div>
          </div>

          {/* Reasignar — sólo nivel 1-2 */}
          {canReassign && team.length > 0 && (
            <div className="space-y-2 rounded-xl border border-border bg-card p-3">
              <h3 className="flex items-center gap-1.5 text-sm font-bold">
                <UserCog className="h-3.5 w-3.5" /> Reasignar
              </h3>
              <select
                value={newAssigned}
                onChange={(e) => setNewAssigned(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option value="">— Selecciona usuario —</option>
                {team.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveReassign}
                  disabled={pending || !newAssigned || newAssigned === ev.assigned_user_id}
                >
                  Reasignar a este usuario
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cerrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
