"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { notify } from "@/shared/hooks/use-toast";
import { madridParts } from "@/shared/lib/format-date";
import { agendarInstalacionPruebaSafeAction } from "./agendar-actions";
import {
  encajaEnDisponibilidad,
  opcionesParaAgendar,
  resumenDisponibilidad,
  type Disponibilidad,
  type OpcionAgenda,
} from "./disponibilidad";

function dosCifras(n: number) {
  return String(n).padStart(2, "0");
}

/** Instante → valor de <input type="datetime-local"> en hora de Madrid. */
function aLocalMadrid(iso: string | null): string {
  if (!iso) return "";
  const p = madridParts(iso);
  return `${p.year}-${dosCifras(p.month)}-${dosCifras(p.day)}T${dosCifras(p.hour)}:${dosCifras(p.minute)}`;
}

/**
 * Tarjeta «Agendar instalación» de la ficha de la prueba (Mario 2026-11-26).
 * Solo la ve quien agenda (admin o director técnico). El aviso de «prueba
 * creada» enlaza aquí con #agendar.
 */
export function AgendarInstalacionPrueba({
  trialId,
  installers,
  inicialFecha,
  inicialInstalador,
  disponibilidad,
  quienPropone = null,
  anclaId = "agendar",
  onAgendada,
}: {
  trialId: string;
  installers: { user_id: string; full_name: string }[];
  inicialFecha: string | null;
  inicialInstalador: string | null;
  disponibilidad: Disponibilidad | null;
  /** Nombre del comercial que pidió la prueba (para «X propone…»). */
  quienPropone?: string | null;
  /** id del contenedor; en la agenda hay varias tarjetas a la vez. */
  anclaId?: string;
  onAgendada?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fecha, setFecha] = useState(aLocalMadrid(inicialFecha));
  const [instalador, setInstalador] = useState(inicialInstalador ?? "");
  const yaAgendada = !!inicialFecha && !!inicialInstalador;
  const fueraDeDisponibilidad =
    !!fecha && encajaEnDisponibilidad(disponibilidad, fecha) === false;
  // Se calcula en el navegador para que no choque con el HTML del servidor.
  const [minimo, setMinimo] = useState<string | undefined>(undefined);
  // Huecos propuestos por el comercial, a partir de hoy (Madrid).
  const [opciones, setOpciones] = useState<OpcionAgenda[]>([]);
  useEffect(() => {
    const ahora = aLocalMadrid(new Date().toISOString());
    setMinimo(ahora);
    setOpciones(
      opcionesParaAgendar(disponibilidad, ahora.slice(0, 10)).filter((o) => o.valor >= ahora),
    );
  }, [disponibilidad]);
  const resumen = resumenDisponibilidad(disponibilidad);

  function guardar() {
    if (!fecha) {
      notify.warning("Indica el día y la hora");
      return;
    }
    if (!instalador) {
      notify.warning("Elige el instalador");
      return;
    }
    startTransition(async () => {
      const r = await agendarInstalacionPruebaSafeAction({
        trial_id: trialId,
        scheduled_at: fecha,
        installer_user_id: instalador,
      });
      if (!r.ok) {
        notify.error("No se pudo agendar", r.error);
        return;
      }
      notify.success("Instalación agendada", "Le ha llegado el aviso al instalador.");
      onAgendada?.();
      router.refresh();
    });
  }

  return (
    <div
      id={anclaId}
      className="scroll-mt-24 space-y-3 rounded-2xl border-2 border-primary/30 bg-primary/5 p-3"
    >
      <div className="flex items-center gap-2 text-sm font-bold">
        <CalendarClock className="h-4 w-4" aria-hidden />
        {yaAgendada ? "Instalación agendada" : "Agendar instalación"}
      </div>
      {/* Lo que propuso el comercial al pedir la prueba, bien visible y
          con huecos que se eligen de un toque (Mario 2026-11-26). */}
      {resumen.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-2.5 dark:border-emerald-800 dark:bg-emerald-950/30">
          <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
            {quienPropone ? `${quienPropone} propone:` : "El comercial propone:"}
          </p>
          <ul className="space-y-0.5 text-sm font-semibold text-emerald-950 dark:text-emerald-100">
            {resumen.map((linea) => (
              <li key={linea}>{linea}</li>
            ))}
          </ul>
          {opciones.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] text-emerald-900/80 dark:text-emerald-200/80">
                Toca uno para rellenar el día y la hora:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {opciones.map((o) => {
                  const elegido = fecha === o.valor;
                  return (
                    <button
                      key={o.valor}
                      type="button"
                      onClick={() => setFecha(o.valor)}
                      aria-pressed={elegido}
                      className={`min-h-10 rounded-full border px-3 text-xs font-bold transition-colors ${
                        elegido
                          ? "border-emerald-700 bg-emerald-700 text-white"
                          : "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-100 dark:bg-transparent dark:text-emerald-100"
                      }`}
                    >
                      {o.etiqueta}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-xl bg-muted px-2.5 py-2 text-xs text-muted-foreground">
          El comercial no indicó días. Llama al cliente para acordarlo.
        </p>
      )}
      <div className="space-y-1">
        <Label htmlFor={`${anclaId}-fecha`}>Día y hora</Label>
        <Input
          id={`${anclaId}-fecha`}
          type="datetime-local"
          value={fecha}
          min={minimo}
          onChange={(e) => setFecha(e.target.value)}
        />
        {fueraDeDisponibilidad && (
          <p className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
            Esa fecha y hora no están dentro de la disponibilidad del cliente.
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${anclaId}-instalador`}>Instalador</Label>
        <select
          id={`${anclaId}-instalador`}
          value={instalador}
          onChange={(e) => setInstalador(e.target.value)}
          className="h-10 w-full rounded-xl border border-input bg-background px-3 text-base md:text-sm"
        >
          <option value="">— Elegir —</option>
          {installers.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.full_name}
            </option>
          ))}
        </select>
        {installers.length === 0 && (
          <p className="text-[11px] text-muted-foreground">
            No hay usuarios con rol de instalador. Asígnalo en Configuración → Usuarios.
          </p>
        )}
      </div>
      <Button onClick={guardar} disabled={pending} className="h-11 w-full">
        {pending ? "Guardando…" : yaAgendada ? "Cambiar cita" : "Agendar"}
      </Button>
    </div>
  );
}
