"use client";

import { Layers } from "lucide-react";
import { partesDelPackNoElegidas, type PackRole } from "@/shared/lib/packs/complemento";

export interface EquipoConPack {
  id: string;
  display_name: string;
  parent_equipment_id?: string | null;
  pack_role?: PackRole | null;
}

/** Partes del pack que faltan en la selección (vacío si no hay pack con complemento). */
export function faltanDelPack(equipos: EquipoConPack[], seleccion: string[]): string[] {
  return partesDelPackNoElegidas(
    seleccion,
    equipos.map((e) => ({
      id: e.id,
      parent_equipment_id: e.parent_equipment_id ?? null,
      pack_role: e.pack_role ?? null,
    })),
  );
}

/**
 * Aviso de pack con complemento (Horeca + ósmosis/UF) en la retirada: si se
 * marca solo una parte, dice que es parte de un pack y deja elegir entre
 * retirar solo lo marcado o el pack entero (Mario 2026-11-28: «pueden entrar
 * por partes, no todo el pack»).
 */
export function AvisoPackParcial({
  equipos,
  seleccion,
  packEntero,
  onChange,
}: {
  equipos: EquipoConPack[];
  seleccion: string[];
  packEntero: boolean;
  onChange: (packEntero: boolean) => void;
}) {
  const faltan = faltanDelPack(equipos, seleccion);
  if (faltan.length === 0) return null;
  const nombres = faltan
    .map((id) => equipos.find((e) => e.id.toLowerCase() === id)?.display_name ?? "otra parte")
    .join(", ");
  const nombre = "aviso-pack-parcial";
  return (
    <fieldset className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
      <legend className="sr-only">Parte de un pack</legend>
      <p className="flex items-start gap-2 text-xs">
        <Layers className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Lo que has marcado es parte de un pack. El resto del pack es: <strong>{nombres}</strong>.
        </span>
      </p>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-white/60 px-2 text-sm">
        <input
          type="radio"
          name={nombre}
          checked={!packEntero}
          onChange={() => onChange(false)}
          className="h-5 w-5 shrink-0"
        />
        <span>Retirar solo lo marcado (el resto sigue en el cliente)</span>
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-white/60 px-2 text-sm">
        <input
          type="radio"
          name={nombre}
          checked={packEntero}
          onChange={() => onChange(true)}
          className="h-5 w-5 shrink-0"
        />
        <span>Retirar el pack entero</span>
      </label>
    </fieldset>
  );
}
