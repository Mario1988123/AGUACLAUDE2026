import Link from "next/link";
import { Phone, MessageCircle, Navigation, Wrench, ShieldCheck } from "lucide-react";
import { formatDateES } from "@/shared/lib/format-date";
import type { ClientePendienteItem } from "./tecnico-actions";

const ESTADOS: Record<string, string> = {
  scheduled: "programado",
  pre_scheduled: "preprogramado",
  in_progress: "en curso",
  paused: "en pausa",
  completed: "cerrado",
};

function enlaceMapa(c: ClientePendienteItem): string | null {
  if (c.lat != null && c.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
  }
  if (c.direccion) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.direccion)}`;
  }
  return null;
}

/**
 * Lista "Mis clientes" del técnico: tarjetas con el porqué (mantenimiento o
 * instalación) y tres acciones grandes. Sin exportar, sin alta, sin filtros
 * de comercial.
 */
export function MisClientesTecnico({ clientes }: { clientes: ClientePendienteItem[] }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Mis clientes</h1>
        <p className="text-sm text-muted-foreground">
          Los que tienen un mantenimiento o una instalación contigo sin cerrar. Al cerrar el
          trabajo, siguen aquí 24 horas.
        </p>
      </div>

      {clientes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No tienes ningún cliente pendiente ahora mismo.
        </div>
      ) : (
        <ul className="space-y-3">
          {clientes.map((c) => {
            const mapa = enlaceMapa(c);
            const tel = c.telefono?.replace(/[^0-9+]/g, "") ?? null;
            return (
              <li key={c.id} className="rounded-2xl border border-border bg-card p-4">
                <Link href={`/clientes/${c.id}` as never} prefetch={false} className="block">
                  <p className="text-base font-semibold leading-tight">{c.nombre}</p>
                  {c.direccion && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{c.direccion}</p>
                  )}
                </Link>
                <ul className="mt-2 space-y-1">
                  {c.motivos.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={
                          (m.tipo === "mantenimiento"
                            ? `/mantenimientos/${m.id}`
                            : `/instalaciones/${m.id}`) as never
                        }
                        prefetch={false}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        {m.tipo === "mantenimiento" ? (
                          <ShieldCheck className="h-4 w-4" />
                        ) : (
                          <Wrench className="h-4 w-4" />
                        )}
                        {m.tipo === "mantenimiento" ? "Mantenimiento" : "Instalación"}
                        {m.fecha ? ` · ${formatDateES(m.fecha)}` : ""}
                        {ESTADOS[m.estado] ? ` · ${ESTADOS[m.estado]}` : ""}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {tel ? (
                    <a
                      href={`tel:${tel}`}
                      className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-success text-sm font-semibold text-success-foreground"
                    >
                      <Phone className="h-4 w-4" /> Llamar
                    </a>
                  ) : (
                    <span className="inline-flex h-12 items-center justify-center rounded-xl border border-border text-xs text-muted-foreground">
                      Sin teléfono
                    </span>
                  )}
                  {tel ? (
                    <a
                      href={`https://wa.me/${tel.replace(/^\+/, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#25D366] text-sm font-semibold text-white"
                    >
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  ) : (
                    <span />
                  )}
                  {mapa ? (
                    <a
                      href={mapa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border border-border bg-background text-sm font-semibold"
                    >
                      <Navigation className="h-4 w-4" /> Cómo llegar
                    </a>
                  ) : (
                    <span className="inline-flex h-12 items-center justify-center rounded-xl border border-border text-xs text-muted-foreground">
                      Sin dirección
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
