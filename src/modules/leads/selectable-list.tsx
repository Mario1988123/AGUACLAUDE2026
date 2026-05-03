"use client";

import { useState } from "react";
import Link from "next/link";
import { LeadBulkToolbar } from "./bulk-toolbar";
import { STATUS_LABEL, ORIGIN_LABEL } from "./schemas";
import { StatusPill } from "@/shared/components/status-pill";
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

export function SelectableLeadsTable({ leads, team, canBulkReassign }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  return (
    <div className="space-y-3">
      {canBulkReassign && (
        <LeadBulkToolbar
          selectedIds={Array.from(selected)}
          team={team}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {canBulkReassign && (
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected.size === leads.length && leads.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left">Nombre</th>
              <th className="px-4 py-3 text-left">Contacto</th>
              <th className="px-4 py-3 text-left">Origen</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-left">Pot.</th>
              <th className="px-4 py-3 text-right">Días</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads.length === 0 ? (
              <tr>
                <td
                  colSpan={canBulkReassign ? 8 : 7}
                  className="p-8 text-center text-muted-foreground"
                >
                  No hay leads.
                </td>
              </tr>
            ) : (
              leads.map((l) => (
                <tr key={l.id} className="hover:bg-muted/30">
                  {canBulkReassign && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggle(l.id)}
                        className="h-4 w-4"
                      />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/leads/${l.id}` as never}
                        className="font-medium text-primary hover:underline"
                      >
                        {l.display_name}
                      </Link>
                      {l.tags?.includes("reabierto") && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                          ↻ Reabierto
                        </span>
                      )}
                      {!l.assigned_user_id && (
                        <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-700">
                          Sin asignar
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {l.party_kind === "company" ? "Empresa" : "Particular"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {l.email && <div>{l.email}</div>}
                    {l.phone_primary && <div>{l.phone_primary}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs">{ORIGIN_LABEL[l.origin]}</td>
                  <td className="px-4 py-3">
                    <StatusPill
                      label={STATUS_LABEL[l.status]}
                      tone={LEAD_TONE[l.status] ?? "info"}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {l.potential === "unknown" ? "—" : l.potential}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                    {l.days_since_created}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/leads/${l.id}` as never}
                      className="text-sm text-primary hover:underline"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
