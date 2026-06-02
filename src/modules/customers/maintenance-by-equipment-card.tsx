import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Wrench, Calendar, Clock, AlertTriangle, History } from "lucide-react";
import { formatDateES } from "@/shared/lib/format-date";
import type { CustomerEquipmentRow } from "./equipment-actions";
import type { MaintenanceHistoryRow } from "./maintenance-history-card";

/**
 * Card "Mantenimientos" en la ficha del cliente, agrupados por equipo.
 *
 * Por cada equipo del cliente muestra:
 *  - Cabecera: nombre/modelo + dirección + número de serie
 *  - Estado:
 *      · 🔴 VENCIDO si hay scheduled_at pasado y no completado (alertaría
 *        igualmente con el modal emergente al abrir la ficha)
 *      · 🟢 Próximo: dd-mm-aaaa (en X días)
 *      · ⚪ Sin programar
 *  - Último mantenimiento completado (resumen)
 *  - Histórico completo (lista colapsable)
 *
 * Si el cliente no tiene equipos, no se renderiza nada.
 *
 * Sustituye a MaintenanceHistoryCard (que listaba todo en plano sin
 * agrupar por equipo).
 */
interface Props {
  customerId: string;
  equipment: CustomerEquipmentRow[];
  history: MaintenanceHistoryRow[];
}

const KIND_LABEL: Record<string, string> = {
  contracted: "Contratado",
  one_off: "Puntual",
  warranty: "Garantía",
};

function eur(c: number | null): string {
  if (c == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(c / 100);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export function MaintenanceByEquipmentCard({
  customerId,
  equipment,
  history,
}: Props) {
  if (equipment.length === 0) return null;

  // Histórico agrupado por customer_equipment_id (null en su propio cubo
  // "sin equipo" que solo mostramos si tiene entradas).
  const historyByEquip = new Map<string, MaintenanceHistoryRow[]>();
  const orphanHistory: MaintenanceHistoryRow[] = [];
  for (const h of history) {
    if (h.customer_equipment_id) {
      const arr = historyByEquip.get(h.customer_equipment_id) ?? [];
      arr.push(h);
      historyByEquip.set(h.customer_equipment_id, arr);
    } else {
      orphanHistory.push(h);
    }
  }

  const now = new Date();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 flex-wrap">
          <Wrench className="h-5 w-5" />
          Mantenimientos por equipo
          <Badge variant="secondary">{equipment.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {equipment.map((eq) => {
            const equipName =
              eq.product_name ?? eq.external_model_name ?? "Equipo";
            const equipHistory = historyByEquip.get(eq.id) ?? [];
            const last = equipHistory[0];

            const next = eq.next_maintenance_at
              ? new Date(eq.next_maintenance_at)
              : null;
            const isOverdue = next ? next < now : false;
            const daysToNext = next ? daysBetween(next, now) : null;

            return (
              <li
                key={eq.id}
                className="rounded-xl border bg-card p-3 text-sm space-y-2"
              >
                {/* Cabecera equipo */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{equipName}</div>
                    <div className="text-xs text-muted-foreground space-x-1">
                      {eq.serial_number && (
                        <span>SN: {eq.serial_number}</span>
                      )}
                      {eq.installed_at && (
                        <span>· Instalado {formatDateES(eq.installed_at)}</span>
                      )}
                      {eq.address_label && (
                        <span>· {eq.address_label}</span>
                      )}
                    </div>
                  </div>
                  {eq.is_active ? (
                    <Badge variant="success">Activo</Badge>
                  ) : (
                    <Badge variant="secondary">Retirado</Badge>
                  )}
                </div>

                {/* Estado del próximo mantenimiento */}
                <div className="rounded-md border bg-muted/30 p-2 text-xs">
                  {next ? (
                    isOverdue ? (
                      <div className="flex items-center gap-2 text-red-800">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>
                          <strong>VENCIDO</strong> · estaba programado{" "}
                          {formatDateES(eq.next_maintenance_at)} ({Math.abs(daysToNext ?? 0)} días)
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-emerald-800">
                        <Calendar className="h-4 w-4 shrink-0" />
                        <span>
                          Próximo: <strong>{formatDateES(eq.next_maintenance_at)}</strong>
                          {daysToNext != null && daysToNext >= 0 && (
                            <span className="text-muted-foreground">
                              {" "}
                              (en {daysToNext} {daysToNext === 1 ? "día" : "días"})
                            </span>
                          )}
                        </span>
                      </div>
                    )
                  ) : (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="h-4 w-4 shrink-0" />
                      Sin próximo mantenimiento programado.
                    </div>
                  )}
                  {last && (
                    <div className="mt-1 flex items-center gap-2 text-muted-foreground">
                      <History className="h-3.5 w-3.5 shrink-0" />
                      Último:{" "}
                      <Link
                        href={`/mantenimientos/${last.id}` as never}
                        className="font-semibold text-primary hover:underline"
                      >
                        {formatDateES(last.completed_at)}
                      </Link>
                      {last.technician_name && (
                        <span>· {last.technician_name}</span>
                      )}
                      {last.nps_score != null && (
                        <Badge
                          variant={
                            last.nps_score >= 4
                              ? "success"
                              : last.nps_score >= 3
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          NPS {last.nps_score}/5
                        </Badge>
                      )}
                    </div>
                  )}
                </div>

                {/* Histórico completo del equipo (colapsable). Cada
                    fila muestra fecha + tipo + técnico + importe + NPS +
                    contrato vinculado + piezas + notas. El objetivo es
                    ver qué se hizo en cada uno sin tener que abrir la
                    ficha del mantenimiento. */}
                {equipHistory.length > 1 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer font-semibold text-primary hover:underline">
                      Ver histórico completo ({equipHistory.length})
                    </summary>
                    <ul className="mt-2 space-y-2 border-l-2 border-muted pl-3">
                      {equipHistory.map((h) => (
                        <li key={h.id} className="space-y-0.5">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/mantenimientos/${h.id}` as never}
                              className="font-semibold text-primary hover:underline"
                            >
                              {formatDateES(h.completed_at)}
                            </Link>
                            <span className="text-muted-foreground">
                              {KIND_LABEL[h.kind] ?? h.kind}
                            </span>
                            {h.technician_name && (
                              <span className="text-muted-foreground">
                                · {h.technician_name}
                              </span>
                            )}
                            {h.is_charged && h.charge_cents != null && (
                              <span className="font-semibold tabular-nums">
                                · {eur(h.charge_cents)}
                              </span>
                            )}
                            {h.nps_score != null && (
                              <span className="text-muted-foreground">
                                · NPS {h.nps_score}/5
                              </span>
                            )}
                            {h.contract_id && (
                              <Link
                                href={`/contratos/${h.contract_id}` as never}
                                className="text-blue-700 hover:underline"
                                title="Mantenimiento vinculado a un contrato"
                              >
                                · 📑 Contrato
                              </Link>
                            )}
                          </div>
                          {h.replaced_items.length > 0 && (
                            <div className="flex flex-wrap gap-1 pl-2 text-[11px]">
                              {h.replaced_items.map((it, idx) => (
                                <span
                                  key={idx}
                                  className="rounded-md bg-muted px-1.5 py-0.5"
                                >
                                  <strong>{it.quantity}×</strong>{" "}
                                  {it.product_name}
                                </span>
                              ))}
                            </div>
                          )}
                          {h.notes && (
                            <div className="pl-2 text-[11px] italic text-muted-foreground">
                              &ldquo;
                              {h.notes.length > 140
                                ? `${h.notes.slice(0, 140)}…`
                                : h.notes}
                              &rdquo;
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* Acciones por equipo */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Link
                    href={
                      `/mantenimientos/nueva?customer_id=${customerId}&equipment_id=${eq.id}` as never
                    }
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    Programar mantenimiento
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Cubo de huérfanos: mantenimientos sin customer_equipment_id.
            Mostramos solo si hay alguno, para no perderlos. */}
        {orphanHistory.length > 0 && (
          <details className="mt-4 text-xs">
            <summary className="cursor-pointer font-semibold text-muted-foreground">
              Mantenimientos sin equipo asociado ({orphanHistory.length})
            </summary>
            <ul className="mt-2 space-y-1 border-l-2 border-muted pl-3">
              {orphanHistory.map((h) => (
                <li key={h.id}>
                  <Link
                    href={`/mantenimientos/${h.id}` as never}
                    className="font-semibold text-primary hover:underline"
                  >
                    {formatDateES(h.completed_at)}
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}
                    · {KIND_LABEL[h.kind] ?? h.kind}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
