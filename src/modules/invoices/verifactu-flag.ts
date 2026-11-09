/**
 * Interruptor GLOBAL de VeriFactu (I31).
 *
 * El flujo VeriFactu tiene fallos conocidos que impiden activarlo con
 * garantías (doble numeración al emitir, rollback a number NULL, estados
 * fuera del enum, choque con el trigger de inmutabilidad, envío duplicado,
 * <Desglose> vacío, huella/XML/QR con formatos distintos…: ver la auditoría
 * del 01-10-2026). Hoy las 4 empresas están en `no_envio` y sin certificado.
 *
 * Mientras esto valga `false`:
 *  · subir el certificado NO cambia el modo a `verifactu_test`;
 *  · no se puede elegir `verifactu_test` ni `verifactu` en la configuración;
 *  · `getCompanyInvoicingMode` devuelve SIEMPRE "simple", aunque haya
 *    certificado, así que ni las facturas ni las cuotas toman el camino V2.
 *
 * Solo se pone a `true` cuando se haya rediseñado y probado el flujo.
 *
 * NO afecta a la vía Verifacti (external-providers/verifacti-envio.ts): esa
 * se activa empresa a empresa con company_settings.external_invoicing_activo
 * desde Configuración → Facturación, y exige que este envío directo esté en
 * `no_envio` para no registrar dos veces la misma factura.
 */
export const VERIFACTU_HABILITADO = false;

/**
 * Interruptor GLOBAL de la vía Verifacti (pausada el 2026-11-09 a petición de
 * Mario: VeriFactu no se va a usar como mínimo hasta 2028 y de momento no se
 * factura desde el CRM).
 *
 * Mientras valga `false`:
 *  · no se envía ningún alta, anulación ni consulta a Verifacti (ni al
 *    emitir, ni al cobrar, ni desde el cron horario);
 *  · no se puede activar Verifacti en Configuración → Facturación.
 *
 * Las facturas se siguen emitiendo con normalidad. Al reactivarlo, las
 * emitidas mientras estuvo pausado NO se envían solas: habría que darlas de
 * alta a mano.
 */
export const VERIFACTI_HABILITADO = false;

export const MENSAJE_VERIFACTI_PAUSADO =
  "El registro en VeriFactu está pausado en esta versión. Se sigue facturando en modo normal.";

export const MENSAJE_VERIFACTU_DESHABILITADO =
  "VeriFactu está desactivado en esta versión mientras se revisa su implementación. Se sigue facturando en modo normal.";
