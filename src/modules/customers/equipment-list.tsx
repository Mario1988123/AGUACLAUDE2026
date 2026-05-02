import Link from "next/link";
import { Wrench, Package, MapPin, ShieldCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import type { CustomerEquipmentRow } from "./equipment-actions";

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-ES");
}

function isWarrantyActive(until: string | null): boolean {
  if (!until) return false;
  return new Date(until).getTime() > Date.now();
}

export function CustomerEquipmentList({ equipment }: { equipment: CustomerEquipmentRow[] }) {
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
                </div>
              </div>
              {e.installation_id && (
                <Link
                  href={`/instalaciones/${e.installation_id}`}
                  className="text-xs text-primary hover:underline"
                >
                  Ver instalación →
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
