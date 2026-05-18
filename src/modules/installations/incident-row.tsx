"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { notify } from "@/shared/hooks/use-toast";
import {
  resolveInstallationIncidentAction,
  reclassifyInstallationIncidentAction,
} from "./wizard-actions";

const INCIDENT_KIND_LABEL: Record<string, string> = {
  stock_shortage: "Stock insuficiente",
  missing_material: "Falta material auxiliar",
  wrong_equipment: "Equipo equivocado",
  broken_equipment: "Equipo dañado",
  customer_issue: "Problema con el cliente",
  other: "Otro",
};

const KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "stock_shortage", label: "Stock insuficiente" },
  { value: "missing_material", label: "Falta material auxiliar" },
  { value: "wrong_equipment", label: "Equipo equivocado" },
  { value: "broken_equipment", label: "Equipo dañado" },
  { value: "customer_issue", label: "Problema con el cliente" },
  { value: "other", label: "Otro" },
];

interface Props {
  id: string;
  kind: string | null;
  title: string | null;
  description: string | null;
  createdAt: string;
  source: "installation_incidents" | "incidents";
  canManage: boolean;
}

export function InstallationIncidentRow({
  id,
  kind,
  title,
  description,
  createdAt,
  source,
  canManage,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draftKind, setDraftKind] = useState(kind ?? "other");

  const label = title
    ? title
    : kind
      ? INCIDENT_KIND_LABEL[kind] ?? kind
      : "Incidencia";

  function resolve() {
    startTransition(async () => {
      const r = await resolveInstallationIncidentAction({
        incident_id: id,
        source,
      });
      if (!r.ok) {
        notify.error("No se pudo resolver", r.error);
        return;
      }
      notify.success("Incidencia resuelta");
      router.refresh();
    });
  }

  function reclassify() {
    if (draftKind === kind) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const r = await reclassifyInstallationIncidentAction({
        incident_id: id,
        kind: draftKind as
          | "stock_shortage"
          | "missing_material"
          | "wrong_equipment"
          | "broken_equipment"
          | "customer_issue"
          | "other",
      });
      if (!r.ok) {
        notify.error("No se pudo reclasificar", r.error);
        return;
      }
      notify.success("Tipo actualizado");
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <li className="rounded-lg border border-red-200 bg-white p-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing && source === "installation_incidents" ? (
            <div className="flex items-center gap-2">
              <select
                value={draftKind}
                onChange={(e) => setDraftKind(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={reclassify} disabled={pending}>
                Guardar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraftKind(kind ?? "other");
                  setEditing(false);
                }}
                disabled={pending}
              >
                Cancelar
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-red-900">{label}</span>
              {canManage && source === "installation_incidents" && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded p-0.5 text-red-700 hover:bg-red-100"
                  title="Reclasificar"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {description && (
            <div className="mt-0.5 text-xs text-red-800">{description}</div>
          )}
        </div>
        <div className="shrink-0 text-[11px] text-red-700">
          {new Date(createdAt).toLocaleString("es-ES", {
            timeZone: "Europe/Madrid",
          })}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {source === "incidents" ? (
          <Link
            href={`/incidencias/${id}` as never}
            className="text-xs font-bold text-red-700 underline hover:text-red-900"
          >
            Ver en módulo de incidencias →
          </Link>
        ) : (
          <span />
        )}
        {canManage && (
          <Button
            size="sm"
            variant="success"
            onClick={resolve}
            disabled={pending}
            className="gap-1"
          >
            <Check className="h-3 w-3" />
            {pending ? "Resolviendo…" : "Marcar resuelta"}
          </Button>
        )}
      </div>
    </li>
  );
}
