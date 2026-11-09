import { notify } from "@/shared/hooks/use-toast";
import type { ResultadoRetiradaManual } from "./retirada-manual-actions";

/**
 * Avisa al usuario de lo que ha hecho una retirada manual. Los avisos
 * (contrato que sigue cobrando, fianza sin gestionar…) salen como warning
 * aparte para que no se pierdan.
 */
export function notificarResultadoRetirada(r: ResultadoRetiradaManual): void {
  const partes = [r.reference_code];
  if (r.ordenes_canceladas.length > 0) {
    partes.push(`Retirada programada cancelada: ${r.ordenes_canceladas.join(", ")}.`);
  }
  if (r.contratos_finalizados.length > 0) {
    partes.push(`Contrato finalizado (deja de cobrar): ${r.contratos_finalizados.join(", ")}.`);
  }
  if (r.contratos_mantenimiento_cancelados > 0) {
    partes.push(`Contratos de mantenimiento cancelados: ${r.contratos_mantenimiento_cancelados}.`);
  }
  if (r.mantenimientos_cancelados > 0) {
    partes.push(`Mantenimientos cancelados: ${r.mantenimientos_cancelados}.`);
  }
  notify.success("Equipo retirado", partes.join(" "));
  if (r.avisos.length > 0) {
    notify.warning("Revisa el cobro", r.avisos.join(" "));
  }
}
