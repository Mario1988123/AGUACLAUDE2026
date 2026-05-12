"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Eye,
  MapPin,
  Mail,
  Phone,
  Trash2,
  XCircle,
  X,
  FileText,
} from "lucide-react";
import { LeadBulkToolbar } from "./bulk-toolbar";
import { STATUS_LABEL, ORIGIN_LABEL } from "./schemas";
import { StatusPill } from "@/shared/components/status-pill";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import { useConfirm } from "@/shared/components/confirm-dialog";
import { deleteLeadAction, markLeadAsLostAction } from "./actions";
import type { LeadListItem } from "./types";

const LEAD_TONE: Record<
  string,
  "info" | "processing" | "success" | "rejected" | "onhold" | "neutral"
> = {
  new: "info",
  contacted: "onhold",
  proposal_created: "processing",
  proposal_sent: "processing",
  free_trial_proposed: "processing",
  converted: "success",
  lost: "rejected",
  expired: "neutral",
};

interface Props {
  leads: LeadListItem[];
  team: { user_id: string; full_name: string }[];
  canBulkReassign: boolean;
}

function ageClass(status: string, days: number): string {
  if (status === "converted") return "text-emerald-700";
  if (days < 3) return "text-emerald-600";
  if (days < 7) return "text-amber-600";
  if (days < 14) return "text-orange-600";
  return "text-red-600 font-bold";
}

function rowBg(status: string): string {
  if (status === "new") return "bg-blue-50/60 hover:bg-blue-50";
  if (status === "converted") return "hover:bg-emerald-50/40";
  return "hover:bg-muted/30";
}

export function SelectableLeadsTable({ leads, team, canBulkReassign }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();
  const router = useRouter();
  const [lostReasonOpen, setLostReasonOpen] =
    useState<{ id: string; name: string } | null>(null);
  const [lostReason, setLostReason] = useState("");

  async function onDelete(id: string, name: string) {
    const ok = await ask({
      title: "Eliminar lead",
      message: `¿Eliminar el lead «${name}»? Esta acción es irreversible.`,
      confirmText: "Eliminar",
      variant: "destructive",
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await deleteLeadAction(id);
        notify.success("Lead eliminado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function openLostModal(id: string, name: string) {
    setLostReason("");
    setLostReasonOpen({ id, name });
  }

  function confirmLost() {
    if (!lostReasonOpen) return;
    const { id } = lostReasonOpen;
    startTransition(async () => {
      try {
        await markLeadAsLostAction(id, lostReason.trim() || null);
        notify.success("Lead marcado como venta perdida — propuestas rechazadas");
        setLostReasonOpen(null);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((s) =>
      s.size === leads.length ? new Set() : new Set(leads.map((l) => l.id)),
    );
  }

  // La búsqueda se hace ahora server-side desde el formulario de filtros
  // del listado (`q=`). Mantenemos `visible` como alias de `leads` para no
  // romper el resto del render.
  const visible = leads;

  return (
    <div className="space-y-3">
      {canBulkReassign && (
        <LeadBulkToolbar
          selectedIds={Array.from(selected)}
          team={team}
          onClear={() => setSelected(new Set())}
        />
      )}

      {/* Búsqueda eliminada — se hace desde el formulario de filtros del
          listado (server-side) para no duplicar UX. */}

      {lostReasonOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setLostReasonOpen(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-4">
              <div>
                <h2 className="text-base font-bold">Marcar como venta perdida</h2>
                <p className="text-xs text-muted-foreground">{lostReasonOpen.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setLostReasonOpen(null)}
                className="rounded-full p-2 hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                ⚠ Todas las propuestas vivas de este lead se marcarán como
                <strong> rechazadas</strong> automáticamente.
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Motivo (opcional)
                </label>
                <textarea
                  rows={3}
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  placeholder="Ej. precio, competencia, no le interesa…"
                  className="w-full rounded-xl border border-input bg-background p-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t bg-muted/20 p-3">
              <Button
                variant="outline"
                onClick={() => setLostReasonOpen(null)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={confirmLost} disabled={pending} variant="destructive">
                Marcar como perdida
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {canBulkReassign && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === visible.length && visible.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4"
                  />
                </th>
              )}
              <th className="px-3 py-3 text-left">Contacto</th>
              <th className="px-3 py-3 text-left">Ubicación</th>
              <th className="px-3 py-3 text-left">Provincia</th>
              <th className="px-3 py-3 text-left">Origen</th>
              <th className="px-3 py-3 text-left">Estado</th>
              <th className="px-3 py-3 text-right">Días</th>
              <th className="px-3 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={canBulkReassign ? 8 : 7}
                  className="p-8 text-center text-muted-foreground"
                >
                  No hay leads.
                </td>
              </tr>
            ) : (
              visible.map((l) => {
                const mapsUrl =
                  l.address_lat != null && l.address_lng != null
                    ? `https://www.google.com/maps/search/?api=1&query=${l.address_lat},${l.address_lng}`
                    : l.address_city
                      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                          [
                            l.address_street,
                            l.address_city,
                            l.address_province,
                            "España",
                          ]
                            .filter(Boolean)
                            .join(", "),
                        )}`
                      : null;
                const isCompany = l.party_kind === "company";
                return (
                  <tr key={l.id} className={rowBg(l.status)}>
                    {canBulkReassign && (
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(l.id)}
                          onChange={() => toggle(l.id)}
                          className="h-4 w-4"
                        />
                      </td>
                    )}

                    {/* CONTACTO — particular: solo nombre. Empresa: razón
                        social/comercial en negrita + persona contacto debajo */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          href={`/leads/${l.id}` as never}
                          className="font-bold text-primary hover:underline"
                        >
                          {l.display_name}
                        </Link>
                        {/* "Nuevo" ya sale en la columna ESTADO. Aquí
                            reservamos espacio para indicadores propios del
                            lead que NO se reflejan en el status oficial. */}
                        {l.tags?.includes("reabierto") && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800">
                            ↻ Reabierto
                          </span>
                        )}
                        {l.has_active_trial && (
                          <span
                            title="Prueba gratuita activa"
                            className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700"
                          >
                            🎁 Prueba activa
                          </span>
                        )}
                        {l.has_open_incident && (
                          <span
                            title="Incidencia abierta en la prueba"
                            className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-red-700"
                          >
                            🚨 Incidencia
                          </span>
                        )}
                      </div>
                      {isCompany && l.contact_name && (
                        <div className="text-xs text-muted-foreground">
                          {l.contact_name}
                        </div>
                      )}
                    </td>

                    {/* UBICACIÓN — calle + ciudad */}
                    <td className="px-3 py-2.5 text-xs">
                      <div className="min-w-0">
                        {l.address_street && (
                          <div className="truncate">{l.address_street}</div>
                        )}
                        <div className="font-semibold truncate">
                          {l.address_city ?? "—"}
                        </div>
                      </div>
                    </td>

                    {/* PROVINCIA — separada y resaltada */}
                    <td className="px-3 py-2.5 text-xs font-semibold">
                      {l.address_province ?? "—"}
                    </td>

                    {/* ORIGEN */}
                    <td className="px-3 py-2.5 text-xs">{ORIGIN_LABEL[l.origin]}</td>

                    {/* ESTADO */}
                    <td className="px-3 py-2.5">
                      <StatusPill
                        label={STATUS_LABEL[l.status]}
                        tone={LEAD_TONE[l.status] ?? "info"}
                      />
                    </td>

                    {/* DÍAS */}
                    <td
                      className={`px-3 py-2.5 text-right text-xs tabular-nums ${ageClass(l.status, l.days_since_created)}`}
                    >
                      {l.days_since_created}d
                    </td>

                    {/* ACCIONES — ojo, tlf, email, mapa, propuesta (si tiene),
                        eliminar/perdido (rojo) */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <Link
                          href={`/leads/${l.id}` as never}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          title="Ver ficha"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                        {l.phone_primary && (
                          <a
                            href={`tel:${l.phone_primary}`}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
                            title={`Llamar ${l.phone_primary}`}
                          >
                            <Phone className="h-4 w-4" />
                          </a>
                        )}
                        {l.email && (
                          <a
                            href={`mailto:${l.email}`}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-blue-100 hover:text-blue-700"
                            title={`Email a ${l.email}`}
                          >
                            <Mail className="h-4 w-4" />
                          </a>
                        )}
                        {mapsUrl && (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener"
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            title="Ver en Google Maps"
                          >
                            <MapPin className="h-4 w-4" />
                          </a>
                        )}
                        {l.has_proposals && (
                          <Link
                            href={`/propuestas?lead=${l.id}` as never}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-violet-600 hover:bg-violet-100"
                            title="Ver propuesta"
                          >
                            <FileText className="h-4 w-4" />
                          </Link>
                        )}
                        {l.has_proposals ? (
                          <button
                            type="button"
                            onClick={() => openLostModal(l.id, l.display_name)}
                            disabled={pending}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                            title="Marcar como venta perdida (rechaza propuestas)"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onDelete(l.id, l.display_name)}
                            disabled={pending}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                            title="Eliminar lead"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
