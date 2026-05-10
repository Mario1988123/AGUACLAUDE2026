"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { notify } from "@/shared/hooks/use-toast";
import {
  adjustCycleLine,
  closeCycle,
  reopenCycle,
  type UserCycleDetail,
} from "./cycles-actions";
import { reasonLabel } from "./reason-labels";

const DEPT_LABEL: Record<string, string> = {
  tech: "Técnico",
  sales: "Comercial",
  tmk: "Telemarketing",
};

function formatEur(cents: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

interface AdjustModalState {
  open: boolean;
  user_id: string;
  user_name: string;
  ledger_entry_id: string | null;
  defaultDelta: number;
  contextLabel: string;
}

const EMPTY_MODAL: AdjustModalState = {
  open: false,
  user_id: "",
  user_name: "",
  ledger_entry_id: null,
  defaultDelta: 0,
  contextLabel: "",
};

export function CycleDetailClient({
  cycleId,
  cycleStatus,
  canManage,
  cyclePeriodEnded,
  eurosPerPoint,
  users,
}: {
  cycleId: string;
  cycleStatus: "open" | "pending_review" | "closed";
  canManage: boolean;
  cyclePeriodEnded: boolean;
  eurosPerPoint: number;
  users: UserCycleDetail[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [modal, setModal] = useState<AdjustModalState>(EMPTY_MODAL);
  const [reason, setReason] = useState("");
  const [delta, setDelta] = useState<number>(0);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const isClosed = cycleStatus === "closed";
  const canEdit = canManage && !isClosed;

  function openAdjust(args: Omit<AdjustModalState, "open">) {
    setModal({ ...args, open: true });
    setDelta(args.defaultDelta);
    setReason("");
  }

  function submitAdjust() {
    if (!Number.isFinite(delta) || delta === 0) {
      notify.error("Delta inválido", "Debe ser distinto de 0");
      return;
    }
    if (reason.trim().length < 3) {
      notify.error("Razón requerida", "Describe el motivo del ajuste");
      return;
    }
    startTransition(async () => {
      try {
        await adjustCycleLine({
          cycle_id: cycleId,
          user_id: modal.user_id,
          ledger_entry_id: modal.ledger_entry_id,
          delta_points: delta,
          reason: reason.trim(),
        });
        notify.success("Ajuste registrado");
        setModal(EMPTY_MODAL);
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function close() {
    if (!cyclePeriodEnded) {
      notify.error(
        "Ciclo aún en curso",
        "El periodo no ha terminado, espera a la fecha de cierre",
      );
      return;
    }
    if (!confirm("¿Cerrar el ciclo? Después no se podrán hacer ajustes.")) return;
    startTransition(async () => {
      try {
        await closeCycle(cycleId);
        notify.success("Ciclo cerrado");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  function submitReopen() {
    if (reopenReason.trim().length < 3) {
      notify.error("Razón requerida", "Indica por qué reabres el ciclo");
      return;
    }
    startTransition(async () => {
      try {
        await reopenCycle(cycleId, reopenReason.trim());
        notify.success("Ciclo reabierto");
        setReopenOpen(false);
        setReopenReason("");
        router.refresh();
      } catch (err) {
        notify.error("Error", err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <>
      {canManage && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isClosed ? (
            <Button
              variant="success"
              onClick={close}
              disabled={pending || !cyclePeriodEnded}
            >
              <Lock className="h-4 w-4" /> Cerrar ciclo
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setReopenOpen(true)}
              disabled={pending}
            >
              <RotateCcw className="h-4 w-4" /> Reabrir ciclo
            </Button>
          )}
        </div>
      )}

      {users.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Sin puntos otorgados en este ciclo.
          </CardContent>
        </Card>
      ) : (
        users.map((u) => (
          <Card key={u.user_id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span>{u.user_name}</span>{" "}
                  {u.department && (
                    <Badge variant="outline" className="ml-2">
                      {DEPT_LABEL[u.department] ?? u.department}
                    </Badge>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-2xl font-extrabold tabular-nums text-primary">
                    {u.net_points} pts
                  </div>
                  {eurosPerPoint > 0 && (
                    <div className="text-sm text-muted-foreground tabular-nums">
                      {formatEur(u.net_cents)}
                    </div>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-muted/50 p-2">
                  <div className="text-muted-foreground">Base ledger</div>
                  <div className="font-bold tabular-nums">{u.base_points}</div>
                </div>
                <div
                  className={`rounded-lg p-2 ${
                    u.adjustments_total > 0
                      ? "bg-emerald-50"
                      : u.adjustments_total < 0
                        ? "bg-rose-50"
                        : "bg-muted/50"
                  }`}
                >
                  <div className="text-muted-foreground">Ajustes</div>
                  <div className="font-bold tabular-nums">
                    {u.adjustments_total > 0 ? "+" : ""}
                    {u.adjustments_total}
                  </div>
                </div>
                <div className="rounded-lg bg-primary/5 p-2">
                  <div className="text-muted-foreground">Neto</div>
                  <div className="font-bold tabular-nums text-primary">
                    {u.net_points}
                  </div>
                </div>
              </div>

              {u.lines.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Líneas del ledger
                  </div>
                  <ul className="divide-y rounded-lg border">
                    {u.lines.map((line) => (
                      <li
                        key={line.ledger_id}
                        className="flex items-center justify-between gap-3 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">
                            {reasonLabel(line.reason)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(line.awarded_at).toLocaleString("es-ES")}
                            {line.subject_type && (
                              <>
                                {" · "}
                                <span className="text-[11px]">
                                  {line.subject_type}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div
                          className={`text-sm font-bold tabular-nums ${
                            line.points >= 0 ? "text-emerald-700" : "text-rose-700"
                          }`}
                        >
                          {line.points > 0 ? "+" : ""}
                          {line.points}
                        </div>
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              openAdjust({
                                user_id: u.user_id,
                                user_name: u.user_name,
                                ledger_entry_id: line.ledger_id,
                                defaultDelta: 0,
                                contextLabel: `${reasonLabel(line.reason)} (${line.points > 0 ? "+" : ""}${line.points} pts)`,
                              })
                            }
                          >
                            <Pencil className="h-3 w-3" /> Ajustar
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {u.adjustments.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Ajustes aplicados
                  </div>
                  <ul className="divide-y rounded-lg border bg-amber-50/40">
                    {u.adjustments.map((a) => (
                      <li key={a.id} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold">{a.reason}</div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(a.adjusted_at).toLocaleString("es-ES")} ·{" "}
                              <strong>{a.adjusted_by_name ?? "—"}</strong>
                              {a.ledger_entry_id && " · sobre línea ledger"}
                            </div>
                          </div>
                          <div
                            className={`text-sm font-bold tabular-nums ${
                              a.delta_points >= 0
                                ? "text-emerald-700"
                                : "text-rose-700"
                            }`}
                          >
                            {a.delta_points > 0 ? "+" : ""}
                            {a.delta_points}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    openAdjust({
                      user_id: u.user_id,
                      user_name: u.user_name,
                      ledger_entry_id: null,
                      defaultDelta: 0,
                      contextLabel: "Ajuste libre del periodo",
                    })
                  }
                >
                  <Plus className="h-4 w-4" /> Ajuste libre para {u.user_name}
                </Button>
              )}
            </CardContent>
          </Card>
        ))
      )}

      <Dialog open={modal.open} onOpenChange={(o) => !o && setModal(EMPTY_MODAL)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar puntos · {modal.user_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{modal.contextLabel}</p>
            <div className="space-y-1.5">
              <Label>Delta (positivo suma, negativo resta)</Label>
              <Input
                type="number"
                value={delta}
                onChange={(e) => setDelta(Number(e.target.value))}
                placeholder="Ej. +10 o -5"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Razón del ajuste</Label>
              <textarea
                className="min-h-[80px] w-full rounded-md border border-input bg-background p-2 text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. Error en cálculo de comisión por venta del 12/05"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setModal(EMPTY_MODAL)}>
              Cancelar
            </Button>
            <Button onClick={submitAdjust} disabled={pending} variant="success">
              Guardar ajuste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenOpen} onOpenChange={(o) => !o && setReopenOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir ciclo</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Reabrir un ciclo cerrado vuelve a permitir ajustes. La acción queda
              registrada en las notas del ciclo.
            </p>
            <div className="space-y-1.5">
              <Label>Razón</Label>
              <textarea
                className="min-h-[80px] w-full rounded-md border border-input bg-background p-2 text-sm"
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Ej. Detectado error en línea de instalación del 28/05"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReopenOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitReopen} disabled={pending} variant="destructive">
              Reabrir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
