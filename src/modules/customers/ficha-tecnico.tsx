import Link from "next/link";
import { Phone, MessageCircle, Navigation, Wrench, ShieldCheck } from "lucide-react";
import { formatDateES } from "@/shared/lib/format-date";
import { BackButton } from "@/shared/components/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import type { MotivoPendiente } from "@/shared/lib/auth/role-scope";
import type { CustomerEquipmentRow } from "./equipment-actions";
import { ChipModeloEquipo } from "@/modules/equipos-modelo/chip-modelo";
import { ChipMantIncluido } from "@/modules/mant-incluido/chip-mant";

export interface DireccionTecnico {
  id: string;
  texto: string;
  lat: number | null;
  lng: number | null;
  principal: boolean;
}

const ESTADOS: Record<string, string> = {
  scheduled: "programado",
  pre_scheduled: "preprogramado",
  in_progress: "en curso",
  paused: "en pausa",
  completed: "cerrado",
};

/**
 * Ficha de cliente para el técnico (2026-11-12): contacto, direcciones,
 * equipos y sus trabajos pendientes. Solo lectura: sin propuestas, contratos,
 * calculadora, pruebas, edición, etiquetas ni datos bancarios.
 */
export function FichaClienteTecnico({
  nombre,
  telefono,
  telefono2,
  direcciones,
  equipos,
  motivos,
}: {
  nombre: string;
  telefono: string | null;
  telefono2: string | null;
  direcciones: DireccionTecnico[];
  equipos: CustomerEquipmentRow[];
  motivos: MotivoPendiente[];
}) {
  const tel = telefono?.replace(/[^0-9+]/g, "") || null;
  const activos = equipos.filter((e) => e.is_active);
  return (
    <div className="space-y-4">
      <BackButton href="/clientes" />
      <div>
        <h1 className="text-2xl font-bold leading-tight">{nombre}</h1>
        {telefono && <p className="text-sm text-muted-foreground">{telefono}</p>}
        {telefono2 && <p className="text-sm text-muted-foreground">{telefono2}</p>}
      </div>

      {tel && (
        <div className="grid grid-cols-2 gap-2">
          <a
            href={`tel:${tel}`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-success text-sm font-semibold text-success-foreground"
          >
            <Phone className="h-4 w-4" /> Llamar
          </a>
          <a
            href={`https://wa.me/${tel.replace(/^\+/, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#25D366] text-sm font-semibold text-white"
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trabajos contigo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {motivos.map((m) => (
            <Link
              key={m.id}
              href={(m.tipo === "mantenimiento" ? `/mantenimientos/${m.id}` : `/instalaciones/${m.id}`) as never}
              prefetch={false}
              className="flex min-h-12 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              {m.tipo === "mantenimiento" ? (
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Wrench className="h-4 w-4 shrink-0 text-primary" />
              )}
              <span>
                {m.tipo === "mantenimiento" ? "Mantenimiento" : "Instalación"}
                {m.fecha ? ` · ${formatDateES(m.fecha)}` : ""}
                {ESTADOS[m.estado] ? ` · ${ESTADOS[m.estado]}` : ""}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Direcciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {direcciones.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin dirección registrada.</p>
          )}
          {direcciones.map((d) => {
            const destino =
              d.lat != null && d.lng != null ? `${d.lat},${d.lng}` : encodeURIComponent(d.texto);
            return (
              <div key={d.id} className="flex items-center justify-between gap-3">
                <p className="text-sm">
                  {d.texto}
                  {d.principal && direcciones.length > 1 && (
                    <span className="ml-1 text-xs text-muted-foreground">(principal)</span>
                  )}
                </p>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${destino}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-semibold hover:bg-muted"
                >
                  <Navigation className="h-4 w-4" /> Ir
                </a>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Equipos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {activos.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin equipos activos.</p>
          )}
          {activos.map((e) => (
            <div key={e.id} className="rounded-xl border border-border p-3 text-sm">
              <p className="font-semibold">
                {e.parent_equipment_id ? "↳ " : ""}
                {e.product_name ?? e.external_model_name ?? "Equipo"}
              </p>
              {e.modelo && (
                <ChipModeloEquipo
                  etiqueta={e.modelo.etiqueta}
                  pendiente={e.modelo.pendiente}
                  tipo={e.modelo.tipo}
                  className="my-1"
                />
              )}
              {e.mant?.texto && e.mant.estado !== "sin_dato" && (
                <div className="my-1">
                  <ChipMantIncluido mant={e.mant} />
                </div>
              )}
              <p className="text-muted-foreground">
                {e.serial_number ? `N.º serie ${e.serial_number}` : "Sin n.º de serie"}
                {e.installed_at ? ` · instalado ${formatDateES(e.installed_at)}` : ""}
              </p>
              {(e.last_maintenance_at || e.next_maintenance_at) && (
                <p className="text-muted-foreground">
                  {e.last_maintenance_at ? `Último mant. ${formatDateES(e.last_maintenance_at)}` : ""}
                  {e.last_maintenance_at && e.next_maintenance_at ? " · " : ""}
                  {e.next_maintenance_at ? `Próximo ${formatDateES(e.next_maintenance_at)}` : ""}
                </p>
              )}
              {e.notes && <p className="mt-1 text-muted-foreground">{e.notes}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
