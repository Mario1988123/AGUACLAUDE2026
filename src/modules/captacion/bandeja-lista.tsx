"use client";

import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { useRefrescoEnVivo } from "./usar-en-vivo";
import type { ConversacionLista, FiltroBandeja } from "./bandeja-actions";

const FILTROS: Array<{ clave: FiltroBandeja; texto: string }> = [
  { clave: "sin_atender", texto: "Sin atender" },
  { clave: "mias", texto: "Mías" },
  { clave: "todas", texto: "Todas" },
];

const hora = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
const dia = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "Europe/Madrid" });

function cuando(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia = dia.format(d) === dia.format(hoy) && d.getFullYear() === hoy.getFullYear();
  return mismoDia ? hora.format(d) : dia.format(d);
}

export function BandejaLista({
  conversaciones,
  filtro,
}: {
  conversaciones: ConversacionLista[];
  filtro: FiltroBandeja;
}) {
  useRefrescoEnVivo("captacion-bandeja", "captacion_conversaciones");

  return (
    <div className="space-y-4">
      <nav aria-label="Filtrar conversaciones" className="flex gap-2 overflow-x-auto pb-1">
        {FILTROS.map((f) => (
          <Link
            key={f.clave}
            href={`/captacion/bandeja?filtro=${f.clave}` as never}
            aria-current={f.clave === filtro ? "page" : undefined}
            className={cn(
              "inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors",
              f.clave === filtro
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f.texto}
          </Link>
        ))}
      </nav>

      {conversaciones.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {filtro === "sin_atender"
            ? "No hay conversaciones sin atender."
            : filtro === "mias"
              ? "No atiendes ninguna conversación."
              : "Todavía no ha escrito nadie."}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {conversaciones.map((c) => (
            <li key={c.id}>
              <Link
                href={`/captacion/bandeja/${c.id}` as never}
                className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 active:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={cn("truncate", c.noLeidos > 0 ? "font-bold" : "font-medium")}>{c.nombre}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{cuando(c.ultimoAt)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-3">
                    <span className="truncate text-sm text-muted-foreground">
                      {c.ultimaDireccion === "saliente" ? "Tú: " : ""}
                      {c.extracto ?? "Sin mensajes"}
                    </span>
                    {c.noLeidos > 0 ? (
                      <span
                        className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold tabular-nums text-primary-foreground"
                        aria-label={`${c.noLeidos} sin leer`}
                      >
                        {c.noLeidos}
                      </span>
                    ) : c.sinAtender ? (
                      <span className="shrink-0 text-xs text-muted-foreground">Sin atender</span>
                    ) : null}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
