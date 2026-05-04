"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, MapPin, Mail, Phone, Trash2, XCircle, X } from "lucide-react";
import { LeadBulkToolbar } from "./bulk-toolbar";
import { STATUS_LABEL, ORIGIN_LABEL } from "./schemas";
import { StatusPill } from "@/shared/components/status-pill";
import { Input } from "@/shared/ui/input";
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

/**
 * Color visual de la "antigüedad" del lead. Verde = fresco; ámbar = atención;
 * rojo = lleva días sin tocarse. Solo aplica a leads no-convertidos.
 */
function ageClass(status: string, days: number): string {
  if (status === "converted") return "text-emerald-700";
  if (days < 3) return "text-emerald-600";
  if (days < 7) return "text-amber-600";
  if (days < 14) return "text-orange-600";
  return "text-red-600 font-bold";
}

/** Resaltado pastel del row si el lead es "nuevo" (sin contactar todavía). */
function rowBg(status: string): string {
  if (status === "new") return "bg-blue-50/60 hover:bg-blue-50";
  if (status === "converted") return "hover:bg-emerald-50/40";
  return "hover:bg-muted/30";
}

export function SelectableLeadsTable({ leads, team, canBulkReassign }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cityFilter, setCityFilter] = useState("");
  const [pending, startTransition] = useTransition();
  const ask = useConfirm();
  const router = useRouter();
  const [lostReasonOpen, setLostReasonOpen] = useState<{ id: string; name: string } | null>(null);
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
    setSelected((s) => (s.size === leads.length ? new Set() : new Set(leads.map((l) => l.id))));
  }

  const cities = useMemo(
    () =>
      Array.from(
        new Set(leads.map((l) => l.address_city).filter((v): v is string => !!v && v.length > 0)),
      ).sort(),
    [leads],
  );
  const visible = useMemo(
    () =>
      cityFilter
        ? leads.filter(
            (l) =>
              (l.address_city ?? "").toLowerCase().includes(cityFilter.toLowerCase()) ||
              (l.address_province ?? "").toLowerCase().includes(cityFilter.toLowerCase()),
          )
        : leads,
    [leads, cityFilter],
  );

  return (
    <div className="space-y-3">
      {canBulkReassign && (
        <LeadBulkToolbar
          selectedIds={Array.from(selected)}
          team={team}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filtrar por ciudad o provincia..."
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          className="h-9 max-w-xs"
          list="lead-cities"
        />
        <datalist id="lead-cities">
          {cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <span className="text-xs text-muted-foreground">
          {visible.length} de {leads.length}
        </span>
      </div>

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
              <Button variant="outline" onClick={() => setLostReasonOpen(null)} disabled={pending}>
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
              <th className="px-3 py-3 text-left">Origen</th>
              <th className="px-3 py-3 text-left">Estado</th>
              <th className="px-3 py-3 text-left">Ubicación</th>
              <th className="px-3 py-3 text-right">Días</th>
              <th className="px-3 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={canBulkReassign ? 7 : 6}
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
                          [l.address_city, l.address_province, "España"].filter(Boolean).join(", "),
                        )}`
                      : null;
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
                    <td className="px-3 py-2">
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/leads/${l.id}` as never}
                            className="font-semibold text-primary hover:underline"
                          >
                            {l.display_name}
                          </Link>
                          {l.contact_name && (
                            <span className="text-xs text-muted-foreground">
                              · {l.contact_name}
                            </span>
                          )}
                          {l.status === "new" && !l.assigned_user_id && (
                            <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-blue-700">
                              Nuevo
                            </span>
                          )}
                          {l.tags?.includes("reabierto") && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800">
                              ↻ Reabierto
                            </span>
                          )}
                        </div>
                        {(l.phone_primary || l.email) && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                            {l.phone_primary && (
                              <a
                                href={`tel:${l.phone_primary}`}
                                className="inline-flex items-center gap-1 text-foreground/80 hover:text-primary"
                              >
                                <Phone className="h-3 w-3" />
                                {l.phone_primary}
                              </a>
                            )}
                            {l.email && (
                              <a
                                href={`mailto:${l.email}`}
                                className="inline-flex items-center gap-1 text-foreground/80 hover:text-primary"
                              >
                                <Mail className="h-3 w-3" />
                                <span className="truncate max-w-[200px]">{l.email}</span>
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{ORIGIN_LABEL[l.origin]}</td>
                    <td className="px-3 py-2.5">
                      <StatusPill
                        label={STATUS_LABEL[l.status]}
                        tone={LEAD_TONE[l.status] ?? "info"}
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        {mapsUrl && (
                          <a
                            href={mapsUrl}
                            target="_blank"
                            rel="noopener"
                            className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
                            title="Ver en Google Maps"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold truncate">
                            {l.address_city ?? "—"}
                          </div>
                          {l.address_province && (
                            <div className="font-semibold text-foreground/90 truncate">
                              {l.address_province}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right text-xs tabular-nums ${ageClass(l.status, l.days_since_created)}`}
                    >
                      {l.days_since_created}d
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/leads/${l.id}` as never}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          title="Ver ficha"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                        {l.has_proposals ? (
                          <button
                            type="button"
                            onClick={() => openLostModal(l.id, l.display_name)}
                            disabled={pending}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-amber-100 hover:text-amber-700"
                            title="Marcar como venta perdida (rechaza propuestas)"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onDelete(l.id, l.display_name)}
                            disabled={pending}
                            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
