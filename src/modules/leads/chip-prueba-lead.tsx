import Link from "next/link";
import { Gift } from "lucide-react";
import { TEXTO_PRUEBA_PENDIENTE, textoPruebaActiva } from "./prueba-lead";

/**
 * Chip del estado de la prueba gratuita en el lead (Mario 2026-11-26):
 *   · sin instalar → «Instalación pendiente de prueba gratuita»
 *   · instalada    → «Prueba activa · quedan N días»
 * Si se conoce la prueba, el chip abre su ficha. Sirve en servidor y cliente.
 */
export function ChipPruebaLead({
  activa,
  diasRestantes,
  trialId,
  grande = false,
}: {
  activa: boolean;
  diasRestantes?: number | null;
  trialId?: string | null;
  grande?: boolean;
}) {
  const texto = activa ? textoPruebaActiva(diasRestantes ?? null) : TEXTO_PRUEBA_PENDIENTE;
  const tono = activa
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
    : "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  const tamano = grande
    ? "min-h-9 gap-1.5 px-3 py-1 text-xs font-bold"
    : "gap-1 px-1.5 py-0.5 text-[10px] font-bold";
  const clase = `inline-flex max-w-full items-center rounded-full ${tono} ${tamano}`;
  const titulo = activa
    ? "Prueba gratuita instalada en casa del cliente"
    : "Prueba gratuita pedida: el admin la agenda y se instala";
  const contenido = (
    <>
      <Gift className={grande ? "h-3.5 w-3.5 shrink-0" : "h-3 w-3 shrink-0"} aria-hidden />
      <span className="truncate">{texto}</span>
    </>
  );
  if (trialId) {
    return (
      <Link
        href={`/pruebas-gratuitas/${trialId}` as never}
        title={titulo}
        className={`${clase} hover:underline`}
      >
        {contenido}
      </Link>
    );
  }
  return (
    <span title={titulo} className={clase}>
      {contenido}
    </span>
  );
}
