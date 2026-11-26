"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  pruebasParaAvisoAgendarSafeAction,
  type PruebaAvisoAgendar,
} from "./aviso-agendar-actions";

const CLAVE_VISTAS = "pruebas-aviso-agendar-vistas";
const CADA_MS = 30_000;

function leerVistas(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(CLAVE_VISTAS);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function guardarVistas(ids: Set<string>) {
  try {
    window.sessionStorage.setItem(CLAVE_VISTAS, JSON.stringify(Array.from(ids)));
  } catch {
    /* sin almacenamiento: volverá a salir, que es lo seguro */
  }
}

/**
 * Ventana que tapa la pantalla del admin / director técnico con las pruebas
 * gratuitas pendientes de agendar (Mario 2026-11-26: «que moleste, que tenga
 * que cerrarlo»). Sale al entrar en la app si hay alguna y, en directo
 * (cada 30 s y al volver a la pestaña), cada vez que llega una nueva. Solo
 * se quita con «Entendido» o yendo a agendar.
 */
export function AvisoPruebasPorAgendar() {
  const [items, setItems] = useState<PruebaAvisoAgendar[]>([]);
  const [abierto, setAbierto] = useState(false);
  const ultimos = useRef<PruebaAvisoAgendar[]>([]);

  const consultar = useCallback(async () => {
    const r = await pruebasParaAvisoAgendarSafeAction().catch(() => null);
    if (!r || !r.ok) return;
    ultimos.current = r.items;
    const vistas = leerVistas();
    const hayNueva = r.items.some((p) => !vistas.has(p.id));
    if (hayNueva) {
      setItems(r.items);
      setAbierto(true);
    }
  }, []);

  useEffect(() => {
    void consultar();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void consultar();
    }, CADA_MS);
    const alVolver = () => {
      if (document.visibilityState === "visible") void consultar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [consultar]);

  function cerrar() {
    const vistas = leerVistas();
    for (const p of ultimos.current) vistas.add(p.id);
    guardarVistas(vistas);
    setAbierto(false);
  }

  if (!abierto || items.length === 0) return null;
  return <VentanaAvisoPruebas items={items} onCerrar={cerrar} />;
}

/** La ventana en sí (sin datos ni sondeo). */
export function VentanaAvisoPruebas({
  items,
  onCerrar,
}: {
  items: PruebaAvisoAgendar[];
  onCerrar: () => void;
}) {
  const cerrar = onCerrar;
  const una = items.length === 1;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="aviso-pruebas-titulo"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
    >
      <div className="w-full max-w-md space-y-4 rounded-3xl bg-card p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <CalendarClock className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h2 id="aviso-pruebas-titulo" className="text-lg font-bold leading-tight">
              {una ? "Hay una prueba gratuita por agendar" : `Hay ${items.length} pruebas gratuitas por agendar`}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Llama al cliente, cierra día y hora y elige el instalador.
            </p>
          </div>
        </div>
        <ul className="max-h-[45dvh] space-y-2 overflow-y-auto">
          {items.map((p) => (
            <li key={p.id}>
              <Link
                href={`/pruebas-gratuitas/${p.id}#agendar`}
                onClick={cerrar}
                className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-border px-3 py-2 hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{p.cliente}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.comercial ? `${p.comercial} · ` : ""}
                    {p.dias === 0 ? "pedida hoy" : `hace ${p.dias} ${p.dias === 1 ? "día" : "días"}`}
                    {p.referencia ? ` · ${p.referencia}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-bold text-primary">Agendar →</span>
              </Link>
            </li>
          ))}
        </ul>
        <Button onClick={cerrar} className="h-12 w-full text-base">
          Entendido
        </Button>
      </div>
    </div>
  );
}
