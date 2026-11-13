"use client";

import { useState } from "react";
import { AlertTriangle, PencilLine, ScanSearch } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { HojaIdentificarEquipo } from "./hoja-identificar";
import type { DatosHojaIdentificar } from "./datos";
import type { TipoEquipo } from "./logica";

interface Comunes {
  datos: DatosHojaIdentificar;
  customerId: string;
  equipoId?: string | null;
  tipoInicial?: TipoEquipo | null;
}

/**
 * Tarjeta ámbar «Identifica el equipo» para el mantenimiento (técnico).
 * Botón a ancho completo, ≥ 48 px.
 */
export function TarjetaIdentificarMantenimiento({
  maintenanceJobId,
  texto,
  ...c
}: Comunes & { maintenanceJobId: string; texto: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-amber-950">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="font-bold">Identifica el equipo</p>
          <p className="text-sm">{texto}</p>
        </div>
      </div>
      <Button
        type="button"
        size="lg"
        className="mt-3 h-12 w-full bg-amber-600 text-white hover:bg-amber-700"
        onClick={() => setOpen(true)}
      >
        <ScanSearch className="h-5 w-5" />
        Identificar ahora
      </Button>
      <HojaIdentificarEquipo
        open={open}
        onOpenChange={setOpen}
        modo="tecnico"
        maintenanceJobId={maintenanceJobId}
        {...c}
      />
    </div>
  );
}

/** Botones pequeños de la ficha del cliente: Identificar (oficina) / Corregir (admin). */
export function BotonModeloEquipoFicha({
  modo,
  ...c
}: Comunes & { modo: "oficina" | "corregir" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={modo === "oficina" ? "default" : "outline"}
        onClick={() => setOpen(true)}
        className={modo === "oficina" ? "bg-amber-600 text-white hover:bg-amber-700" : ""}
      >
        {modo === "oficina" ? (
          <ScanSearch className="h-4 w-4" />
        ) : (
          <PencilLine className="h-4 w-4" />
        )}
        {modo === "oficina" ? (c.equipoId == null ? "Indicar su equipo" : "Identificar") : "Corregir modelo"}
      </Button>
      <HojaIdentificarEquipo open={open} onOpenChange={setOpen} modo={modo} {...c} />
    </>
  );
}
