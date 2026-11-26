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
import { encajaEnDisponibilidad, type Disponibilidad } from "./disponibilidad";

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
}: {
  trialId: string;
  installers: { user_id: string; full_name: string }[];
  inicialFecha: string | null;
  inicialInstalador: string | null;
  disponibilidad: Disponibilidad | null;
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
  useEffect(() => setMinimo(aLocalMadrid(new Date().toISOString())), []);

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
      router.refresh();
    });
  }

  return (
    <div
      id="agendar"
      className="scroll-mt-24 space-y-3 rounded-2xl border-2 border-primary/30 bg-primary/5 p-3"
    >
      <div className="flex items-center gap-2 text-sm font-bold">
        <CalendarClock className="h-4 w-4" aria-hidden />
        {yaAgendada ? "Instalación agendada" : "Agendar instalación"}
      </div>
      <div className="space-y-1">
        <Label htmlFor="agendar-fecha">Día y hora</Label>
        <Input
          id="agendar-fecha"
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
        <Label htmlFor="agendar-instalador">Instalador</Label>
        <select
          id="agendar-instalador"
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
