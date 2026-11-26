"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Gift } from "lucide-react";
import { AgendarInstalacionPrueba } from "./agendar-instalacion";
import { resumenDisponibilidad } from "./disponibilidad";
import type { PruebaPorAgendar } from "./por-agendar";

/**
 * Bloque plegable «Pruebas gratuitas pendientes de agendar (N)» de la agenda
 * del admin y del director técnico (Mario 2026-11-26). Cerrado por defecto
 * para no tapar el calendario a 390 px; el contador se ve siempre.
 * Cada prueba se agenda desde aquí mismo con la tarjeta de la ficha
 * (huecos propuestos por el comercial de un toque).
 */
export function PruebasPorAgendar({
  total,
  items,
  installers,
}: {
  total: number;
  items: PruebaPorAgendar[];
  installers: { user_id: string; full_name: string }[];
}) {
  const [abierto, setAbierto] = useState(false);
  const [verAntiguas, setVerAntiguas] = useState(false);
  // Desde el dashboard se llega con #pruebas-por-agendar: abrirlo ya.
  useEffect(() => {
    if (window.location.hash === "#pruebas-por-agendar") setAbierto(true);
  }, []);
  if (total === 0) return null;
  const recientes = items.filter((p) => !p.antigua);
  const antiguas = items.filter((p) => p.antigua);

  return (
    <section
      id="pruebas-por-agendar"
      className="scroll-mt-24 rounded-2xl border-2 border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20"
    >
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left"
      >
        <Gift className="h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
        <span className="min-w-0 flex-1 text-base font-bold text-emerald-950 dark:text-emerald-100">
          Pruebas gratuitas pendientes de agendar ({total})
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-emerald-800 transition-transform ${abierto ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {abierto && (
        <div className="space-y-3 px-3 pb-3">
          <p className="px-1 text-xs text-emerald-900 dark:text-emerald-200">
            Las ha pedido un comercial. Llama al cliente con los días que propone y agenda la
            instalación.
          </p>
          {recientes.length > 0 ? (
            <ul className="space-y-2">
              {recientes.map((p) => (
                <FilaPrueba key={p.id} p={p} installers={installers} />
              ))}
            </ul>
          ) : (
            <p className="px-1 text-xs text-muted-foreground">
              Ninguna reciente: solo quedan peticiones antiguas.
            </p>
          )}
          {antiguas.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setVerAntiguas((v) => !v)}
                aria-expanded={verAntiguas}
                className="min-h-10 px-1 text-xs font-bold text-emerald-900 underline-offset-2 hover:underline dark:text-emerald-200"
              >
                {verAntiguas ? "Ocultar" : "Ver"} las antiguas, de más de 30 días ({antiguas.length})
              </button>
              {verAntiguas && (
                <ul className="space-y-2">
                  {antiguas.map((p) => (
                    <FilaPrueba key={p.id} p={p} installers={installers} />
                  ))}
                </ul>
              )}
            </div>
          )}
          {total > items.length && (
            <p className="px-1 text-[11px] text-muted-foreground">
              Se muestran {items.length} de {total}.{" "}
              <Link href={"/pruebas-gratuitas" as never} className="font-semibold underline">
                Ver todas
              </Link>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function FilaPrueba({
  p,
  installers,
}: {
  p: PruebaPorAgendar;
  installers: { user_id: string; full_name: string }[];
}) {
  const [agendando, setAgendando] = useState(false);
  const propone = resumenDisponibilidad(p.disponibilidad);
  return (
    <li className="rounded-xl border border-emerald-200 bg-card p-3 dark:border-emerald-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {p.cliente_href ? (
              <Link
                href={p.cliente_href as never}
                className="truncate text-sm font-bold text-primary hover:underline"
              >
                {p.cliente}
              </Link>
            ) : (
              <span className="truncate text-sm font-bold">{p.cliente}</span>
            )}
            {p.antigua && (
              <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                Antigua
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.comercial ? `Pedida por ${p.comercial}` : "Pedida"} ·{" "}
            {p.dias_desde_peticion === 0
              ? "hoy"
              : p.dias_desde_peticion === 1
                ? "hace 1 día"
                : `hace ${p.dias_desde_peticion} días`}
          </p>
          {p.productos.length > 0 && (
            <p className="mt-0.5 text-xs">{p.productos.join(", ")}</p>
          )}
          <p className="mt-1 text-xs font-semibold text-emerald-900 dark:text-emerald-200">
            {propone.length > 0 ? `Propone: ${propone.join(" · ")}` : "Sin días propuestos"}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAgendando((v) => !v)}
          aria-expanded={agendando}
          className="inline-flex min-h-10 flex-1 items-center justify-center rounded-xl bg-primary px-3 text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          {agendando ? "Cerrar" : "Agendar"}
        </button>
        <Link
          href={`/pruebas-gratuitas/${p.id}` as never}
          className="inline-flex min-h-10 items-center rounded-xl border px-3 text-sm font-semibold hover:bg-muted"
        >
          Ficha
        </Link>
      </div>
      {agendando && (
        <div className="mt-3">
          <AgendarInstalacionPrueba
            trialId={p.id}
            installers={installers}
            inicialFecha={null}
            inicialInstalador={null}
            disponibilidad={p.disponibilidad}
            quienPropone={p.comercial}
            anclaId={`agendar-${p.id}`}
            onAgendada={() => setAgendando(false)}
          />
        </div>
      )}
    </li>
  );
}
