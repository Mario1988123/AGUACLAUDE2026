"use server";

import { requireSession } from "@/shared/lib/auth/session";
import { toActionError } from "@/shared/lib/actions/safe-error";
import { puedeAgendarPrueba } from "./permisos";

export interface PruebaAvisoAgendar {
  id: string;
  referencia: string | null;
  cliente: string;
  comercial: string | null;
  dias: number;
}

/**
 * Pruebas pedidas y sin agendar para la ventana emergente del admin y del
 * director técnico (Mario 2026-11-26). Para el resto devuelve lista vacía.
 */
export async function pruebasParaAvisoAgendarSafeAction(): Promise<
  { ok: true; items: PruebaAvisoAgendar[] } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id || !puedeAgendarPrueba(session)) return { ok: true, items: [] };
    const { listarPruebasPorAgendar } = await import("./por-agendar");
    const { items } = await listarPruebasPorAgendar(session.company_id, 20);
    return {
      ok: true,
      items: items.map((p) => ({
        id: p.id,
        referencia: p.reference_code,
        cliente: p.cliente,
        comercial: p.comercial,
        dias: p.dias_desde_peticion,
      })),
    };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
