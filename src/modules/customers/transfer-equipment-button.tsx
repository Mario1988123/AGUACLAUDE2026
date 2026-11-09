"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Building2, Search, User, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { notify } from "@/shared/hooks/use-toast";
import {
  listTransferTargets,
  previewTransferEquipmentAction,
  transferEquipmentAction,
  type TransferTarget,
} from "./transfer-equipment-actions";
import { MOTIVO_MAX, MOTIVO_MIN, type ResumenTraspaso } from "./traspaso-equipo-logica";

function kindLabel(t: Pick<TransferTarget, "party_kind" | "is_autonomo">): string {
  if (t.party_kind === "company") return t.is_autonomo ? "Autónomo" : "Empresa";
  return "Particular";
}

type Vista = { origen: string; destino: string; bloqueo: string | null; resumen: ResumenTraspaso };

/**
 * Traspasa un equipo (y todo lo que cuelga de él) a otro cliente de la
 * empresa. El equipo no se mueve de sitio. Dos pasos: revisar qué se mueve
 * (no toca nada) y confirmar. En móvil se abre como hoja desde abajo.
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
  const [texto, setTexto] = useState("");
  const [targets, setTargets] = useState<TransferTarget[] | null>(null);
  const [target, setTarget] = useState<TransferTarget | null>(null);
  const [includeChildren, setIncludeChildren] = useState(true);
  const [motivo, setMotivo] = useState("");
  const [vista, setVista] = useState<Vista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargandoVista, setCargandoVista] = useState(false);

  // Buscador con espera corta.
  useEffect(() => {
    if (!open || target) return;
    let vivo = true;
    const t = setTimeout(() => {
      listTransferTargets(customerId, texto)
        .then((r) => vivo && setTargets(r))
        .catch(() => vivo && setTargets([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [open, texto, target, customerId]);

  // Al elegir destino (o cambiar el pack), se calcula qué se mueve.
  useEffect(() => {
    setVista(null);
    setError(null);
    if (!target) return;
    let vivo = true;
    setCargandoVista(true);
    previewTransferEquipmentAction({
      equipment_id: equipmentId,
      target_customer_id: target.id,
      include_children: includeChildren,
    })
      .then((r) => {
        if (!vivo) return;
        if (r.ok) setVista({ origen: r.origen, destino: r.destino, bloqueo: r.bloqueo, resumen: r.resumen });
        else setError(r.error);
      })
      .finally(() => vivo && setCargandoVista(false));
    return () => {
      vivo = false;
    };
  }, [target, includeChildren, equipmentId]);

  function reiniciar() {
    setOpen(false);
    setTexto("");
    setTargets(null);
    setTarget(null);
    setIncludeChildren(true);
    setMotivo("");
    setVista(null);
    setError(null);
  }

  function submit() {
    if (!target || !vista || vista.bloqueo) return;
    startTransition(async () => {
      const r = await transferEquipmentAction({
        equipment_id: equipmentId,
        target_customer_id: target.id,
        include_children: includeChildren,
        motivo,
      });
      if (!r.ok) {
        setError(r.error);
        notify.error("No se pudo traspasar", r.error);
        return;
      }
      const d = r.result;
      const partes = [`${d.equipment_moved} equipo${d.equipment_moved === 1 ? "" : "s"}`];
      if (d.contracts_moved > 0) partes.push(`${d.contracts_moved} contrato(s)`);
      if (d.jobs_moved > 0) partes.push(`${d.jobs_moved} mantenimiento(s)`);
      if (d.maintenance_contracts_moved > 0) partes.push(`${d.maintenance_contracts_moved} contrato(s) de mantenimiento`);
      if (d.incidents_moved > 0) partes.push(`${d.incidents_moved} incidencia(s)`);
      notify.success(
        "Equipo traspasado",
        `A ${vista.destino}: ${partes.join(", ")}.` +
          (d.sepa_mandates_revoked > 0 ? " Falta que firme su mandato SEPA en el contrato." : ""),
      );
      reiniciar();
      router.refresh();
    });
  }

  const motivoOk = motivo.trim().length >= MOTIVO_MIN;
  const related = (targets ?? []).filter((t) => t.related);
  const others = (targets ?? []).filter((t) => !t.related);

  const fila = (t: TransferTarget) => (
    <li key={t.id}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted"
        onClick={() => setTarget(t)}
      >
        <span className="min-w-0 truncate text-sm">{t.label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {kindLabel(t)}
          {t.tax_id ? ` · ${t.tax_id}` : ""}
        </span>
      </button>
    </li>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Traspasar este equipo (y lo que cuelga de él) a otro cliente"
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-muted/30 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted"
      >
        <ArrowLeftRight className="h-3 w-3" />
        Traspasar
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={() => !pending && reiniciar()}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="traspaso-equipo-titulo"
            className="flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-border bg-card shadow-2xl sm:max-w-lg sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border p-4">
              <div className="min-w-0">
                <h2 id="traspaso-equipo-titulo" className="text-base font-bold">
                  Traspasar a otro cliente
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {equipmentName}. El equipo no se mueve de sitio: pasa a otro cliente con todo
                  lo que cuelga de él. Las facturas ya emitidas no se tocan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !pending && reiniciar()}
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* 1. Destino */}
              <div className="space-y-1.5">
                <Label className="text-xs">Pasa a</Label>
                {target ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      {target.party_kind === "company" ? (
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate font-semibold">{target.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{kindLabel(target)}</span>
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-xs font-semibold text-primary hover:underline"
                      onClick={() => setTarget(null)}
                      disabled={pending}
                    >
                      Cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        placeholder="Nombre, razón social o DNI/CIF"
                        className="pl-9 text-base sm:text-sm"
                        autoFocus
                      />
                    </div>
                    <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                      {targets === null ? (
                        <li className="px-3 py-2.5 text-xs text-muted-foreground">Buscando…</li>
                      ) : targets.length === 0 ? (
                        <li className="px-3 py-2.5 text-xs text-muted-foreground">
                          No hay clientes que coincidan. Si no existe, créalo primero en Nuevo cliente.
                        </li>
                      ) : (
                        <>
                          {related.length > 0 && (
                            <li className="bg-muted/40 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                              Comparten DNI/CIF, email o teléfono
                            </li>
                          )}
                          {related.map(fila)}
                          {related.length > 0 && others.length > 0 && (
                            <li className="bg-muted/40 px-3 py-1 text-[11px] font-semibold text-muted-foreground">
                              Otros clientes
                            </li>
                          )}
                          {others.map(fila)}
                        </>
                      )}
                    </ul>
                  </>
                )}
              </div>

              {hasChildren && (
                <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-2">
                  <input
                    type="checkbox"
                    checked={includeChildren}
                    onChange={(e) => setIncludeChildren(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span className="text-xs">
                    <span className="font-semibold">Llevarse también los accesorios</span>
                    <br />
                    <span className="text-muted-foreground">
                      Es un pack. Si lo desmarcas, los accesorios se quedan y el pack queda partido.
                    </span>
                  </span>
                </label>
              )}

              {/* 2. Motivo */}
              <div className="space-y-1.5">
                <Label htmlFor="traspaso-motivo" className="text-xs">
                  Motivo (obligatorio)
                </Label>
                <Textarea
                  id="traspaso-motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  maxLength={MOTIVO_MAX}
                  rows={2}
                  placeholder="Ej.: se dio de alta en la sociedad equivocada del grupo"
                  className="text-base sm:text-sm"
                />
              </div>

              {/* 3. Qué se mueve */}
              {cargandoVista && <p className="text-xs text-muted-foreground">Calculando qué se mueve…</p>}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                  {error}
                </div>
              )}
              {vista?.bloqueo && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
                  {vista.bloqueo}
                </div>
              )}
              {vista && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50">
                  <p className="font-semibold">
                    {vista.origen} → {vista.destino}
                  </p>
                  <div>
                    <p className="font-semibold">Se mueve</p>
                    <ul className="ml-4 list-disc space-y-0.5">
                      {vista.resumen.mueve.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold">No se mueve</p>
                    <ul className="ml-4 list-disc space-y-0.5">
                      {vista.resumen.noMueve.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                  {vista.resumen.avisos.length > 0 && (
                    <div>
                      <p className="font-semibold">Ojo</p>
                      <ul className="ml-4 list-disc space-y-0.5">
                        {vista.resumen.avisos.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={reiniciar} disabled={pending} className="w-full sm:w-auto">
                Cancelar
              </Button>
              <Button
                onClick={submit}
                disabled={pending || !vista || !!vista.bloqueo || !motivoOk}
                className="w-full sm:w-auto"
              >
                {pending ? "Traspasando…" : "Confirmar traspaso"}
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
