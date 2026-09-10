"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Building2, User } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import {
  transferEquipmentAction,
  listTransferTargets,
} from "./transfer-equipment-actions";

type Target = {
  id: string;
  label: string;
  party_kind: "individual" | "company";
  is_autonomo: boolean;
  tax_id: string | null;
  related: boolean;
};

function kindLabel(t: Target): string {
  if (t.party_kind === "company") return t.is_autonomo ? "Autónomo" : "Empresa";
  return "Particular";
}

/**
 * Cambia el TITULAR de un equipo sin moverlo de sitio.
 *
 * El caso: el cliente de siempre quiere uno de sus equipos a nombre de su
 * sociedad y los demás a título personal. Las dos fichas conviven; lo único
 * que cambia es a quién se le facturan las próximas cuotas y visitas.
 */
export function TransferEquipmentButton({
  equipmentId,
  customerId,
  equipmentName,
  hasChildren,
}: {
  equipmentId: string;
  customerId: string;
  equipmentName: string;
  hasChildren?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [targetId, setTargetId] = useState("");
  const [includeChildren, setIncludeChildren] = useState(true);

  useEffect(() => {
    if (!open || targets !== null) return;
    listTransferTargets(customerId)
      .then(setTargets)
      .catch(() => setTargets([]));
  }, [open, targets, customerId]);

  function submit() {
    if (!targetId) {
      notify.error("Elige una ficha", "Hay que decir a nombre de quién queda el equipo.");
      return;
    }
    startTransition(async () => {
      const r = await transferEquipmentAction({
        equipment_id: equipmentId,
        target_customer_id: targetId,
        include_children: includeChildren,
      });
      if (!r.ok) {
        notify.error("No se pudo traspasar", r.error);
        return;
      }
      const d = r.result;
      const partes = [
        `${d.equipment_moved} equipo${d.equipment_moved === 1 ? "" : "s"}`,
      ];
      if (d.jobs_moved > 0) partes.push(`${d.jobs_moved} mantenimiento(s) pendiente(s)`);
      if (d.contracts_moved > 0) partes.push(`${d.contracts_moved} contrato(s)`);
      if (d.incidents_moved > 0) partes.push(`${d.incidents_moved} incidencia(s) abierta(s)`);
      if (d.warnings.length > 0) {
        // El equipo sí se movió, pero algo del arrastre falló. Callarlo dejaría
        // la ficha a medias sin que nadie se entere.
        notify.error(
          "Traspaso incompleto",
          `Se movió el equipo, pero falló: ${d.warnings.join(" · ")}. Revísalo.`,
        );
      } else {
        notify.success("Titular cambiado", `Se ha movido: ${partes.join(", ")}.`);
      }
      setOpen(false);
      router.refresh();
    });
  }

  const related = (targets ?? []).filter((t) => t.related);
  const others = (targets ?? []).filter((t) => !t.related);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Cambiar el titular de este equipo (particular ↔ autónomo ↔ empresa)"
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-muted/30 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
      >
        <ArrowLeftRight className="h-3 w-3" />
        Titular
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold">Cambiar el titular del equipo</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {equipmentName}. El equipo no se mueve de sitio: solo cambia a quién
              se le facturan las próximas cuotas y visitas.
            </p>

            <div className="mt-3 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Pasa a nombre de</Label>
                {targets === null ? (
                  <p className="text-xs text-muted-foreground">Cargando fichas…</p>
                ) : (
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Elige una ficha…</option>
                    {related.length > 0 && (
                      <optgroup label="Mismo titular (comparte DNI/CIF, email o teléfono)">
                        {related.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label} · {kindLabel(t)}
                            {t.tax_id ? ` · ${t.tax_id}` : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {others.length > 0 && (
                      <optgroup label="Otras fichas de la empresa">
                        {others.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label} · {kindLabel(t)}
                            {t.tax_id ? ` · ${t.tax_id}` : ""}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
                {related.length === 0 && targets !== null && (
                  <p className="text-[11px] text-muted-foreground">
                    Este cliente no tiene otra ficha con el mismo DNI/CIF, email o
                    teléfono. Si va a contratar con su sociedad, créala primero
                    desde <span className="font-semibold">Nuevo cliente</span>.
                  </p>
                )}
              </div>

              {hasChildren && (
                <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2">
                  <input
                    type="checkbox"
                    checked={includeChildren}
                    onChange={(e) => setIncludeChildren(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="text-xs">
                    <span className="font-semibold">Llevarse también los accesorios</span>
                    <br />
                    <span className="text-muted-foreground">
                      Es un pack. Si lo desmarcas, los accesorios se quedan con el
                      titular actual y el pack queda partido entre dos fichas.
                    </span>
                  </span>
                </label>
              )}

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                <span className="font-semibold">Se mueve:</span> el equipo, su
                dirección, los mantenimientos pendientes, el contrato activo y las
                incidencias abiertas.
                <br />
                <span className="font-semibold">No se mueve:</span> las facturas ya
                emitidas ni el historial. Eso se queda con quien lo pagó.
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button onClick={submit} disabled={pending || !targetId}>
                {pending ? "Traspasando…" : "Cambiar titular"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Iconito para las listas: de un vistazo, qué clase de titular es. */
export function PartyKindBadge({
  partyKind,
  isAutonomo,
}: {
  partyKind: "individual" | "company";
  isAutonomo?: boolean;
}) {
  const isCompany = partyKind === "company";
  const Icon = isCompany ? Building2 : User;
  const label = isCompany ? (isAutonomo ? "Autónomo" : "Empresa") : "Particular";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
