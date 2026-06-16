import Link from "next/link";
import {
  Wrench,
  Package,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  Clock,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { RelocateEquipmentButton } from "./relocate-button";
import { OfferMaintenanceContractButton } from "./offer-maintenance-contract-button";
import { EquipmentModalityButton } from "./modality-button";
import type { CustomerEquipmentRow } from "./equipment-actions";
import type { MaintenancePlan } from "@/modules/maintenance-plans/actions";

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES");
}

function isWarrantyActive(until: string | null): boolean {
  if (!until) return false;
  return new Date(until).getTime() > Date.now();
}

interface AddressOption {
  id: string;
  label: string;
}

export function CustomerEquipmentList({
  equipment,
  customerId,
  addresses = [],
  canRelocate = false,
  canEditModality = false,
  equipmentsWithActiveContract,
  maintenancePlans = [],
}: {
  equipment: CustomerEquipmentRow[];
  customerId?: string;
  addresses?: AddressOption[];
  canRelocate?: boolean;
  /** Si puede editar la modalidad (venta/alquiler/renting) del equipo. */
  canEditModality?: boolean;
  /** Set de equipment_ids que ya tienen contrato de mantenimiento activo.
   *  Si está, ocultamos el botón "Ofrecer contrato" en esos equipos. */
  equipmentsWithActiveContract?: Set<string>;
  /** Planes de mantenimiento disponibles para ofrecer. */
  maintenancePlans?: MaintenancePlan[];
}) {
  if (equipment.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin equipos registrados. Aparecerán automáticamente al completar instalaciones.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {equipment.map((e) => {
        const name = e.product_name ?? e.external_model_name ?? "Equipo";
        const isOurs = !!e.product_name;
        const warrantyActive = isWarrantyActive(e.warranty_until);
        return (
          <li
            key={e.id}
            className="rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{name}</span>
                  {isOurs ? (
                    <Badge variant="success">Propio</Badge>
                  ) : (
                    <Badge variant="secondary">Externo</Badge>
                  )}
                  {!e.is_active && <Badge variant="destructive">Baja</Badge>}
                </div>
                {e.serial_number && (
                  <div className="text-xs text-muted-foreground">S/N: {e.serial_number}</div>
                )}
                {e.address_label && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {e.address_label}
                  </div>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Instalado: {fmtDate(e.installed_at)}</span>
                  {e.last_maintenance_at && (
                    <span className="inline-flex items-center gap-1">
                      <Wrench className="h-3 w-3" />
                      Último mant.: {fmtDate(e.last_maintenance_at)}
                    </span>
                  )}
                  {(() => {
                    if (!e.next_maintenance_at) return null;
                    const d = new Date(e.next_maintenance_at);
                    const days = Math.ceil(
                      (d.getTime() - Date.now()) / 86400_000,
                    );
                    const overdue = days < 0;
                    const soon = !overdue && days <= 7;
                    return (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-bold ${
                          overdue
                            ? "bg-rose-100 text-rose-800"
                            : soon
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-50 text-emerald-800"
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        Próximo:{" "}
                        {overdue
                          ? `vencido hace ${Math.abs(days)} día${Math.abs(days) === 1 ? "" : "s"}`
                          : days === 0
                            ? "hoy"
                            : `en ${days} día${days === 1 ? "" : "s"}`}
                        <span className="font-normal opacity-75">
                          · {fmtDate(e.next_maintenance_at)}
                        </span>
                      </span>
                    );
                  })()}
                  {e.warranty_until && (
                    <span
                      className={`inline-flex items-center gap-1 ${warrantyActive ? "text-success" : "text-destructive"}`}
                    >
                      {warrantyActive ? (
                        <ShieldCheck className="h-3 w-3" />
                      ) : (
                        <ShieldAlert className="h-3 w-3" />
                      )}
                      Garantía: {fmtDate(e.warranty_until)}
                    </span>
                  )}
                  {canEditModality ? (
                    <EquipmentModalityButton
                      equipmentId={e.id}
                      current={{
                        type: e.acquisition_type,
                        amount_cents: e.acquisition_amount_cents,
                        started_at: e.acquisition_started_at,
                      }}
                    />
                  ) : e.acquisition_type ? (
                    <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-semibold text-violet-800">
                      {e.acquisition_type === "cash"
                        ? "Venta"
                        : e.acquisition_type === "rental"
                          ? "Alquiler"
                          : "Renting"}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                {e.installation_id && (
                  <Link
                    href={`/instalaciones/${e.installation_id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Ver instalación →
                  </Link>
                )}
                {canRelocate && e.is_active && customerId && isOurs && (
                  <RelocateEquipmentButton
                    customerId={customerId}
                    equipmentId={e.id}
                    equipmentName={name}
                    currentAddressId={e.address_id}
                    addresses={addresses}
                  />
                )}
                {/* Botón "Ofrecer contrato de mantenimiento" — solo si el
                    equipo está activo, no tiene contrato vigente y hay
                    planes configurados. La regla 2026-05-25 es que el
                    contrato es POR EQUIPO, no por cliente. */}
                {e.is_active &&
                  customerId &&
                  maintenancePlans.length > 0 &&
                  !equipmentsWithActiveContract?.has(e.id) && (
                    <OfferMaintenanceContractButton
                      customerId={customerId}
                      equipmentId={e.id}
                      equipmentName={name}
                      plans={maintenancePlans}
                    />
                  )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
