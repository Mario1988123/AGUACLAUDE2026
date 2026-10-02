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

export const MENSAJE_VERIFACTU_DESHABILITADO =
  "VeriFactu está desactivado en esta versión mientras se revisa su implementación. Se sigue facturando en modo normal.";
