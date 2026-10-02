/**
 * Utilidades puras del borrado RGPD (art. 17), separadas de la server action
 * para poder testearlas.
 */

/**
 * Enmascara un IBAN conservando el prefijo (país + dígitos de control) y los
 * 4 últimos dígitos, que bastan para la conservación contable mínima.
 */
export function enmascararIban(iban: string): string {
  const limpio = iban.replace(/\s/g, "");
  return limpio.length > 8
    ? limpio.slice(0, 4) + "*".repeat(limpio.length - 8) + limpio.slice(-4)
    : "****";
}
