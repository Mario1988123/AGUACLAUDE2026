/**
 * Guarda de idempotencia para la materialización de contract_payments en
 * Wallet (auditoría 2026-07-13, "doble cobro"): el patrón en los call-sites
 * es insert wallet_entry → update contract_payments.wallet_entry_id. Si el
 * insert va bien pero el update del enlace falla (o el proceso muere entre
 * medias), una re-ejecución ve el pago con wallet_entry_id NULL y volvería a
 * insertar → el mismo pago aparecería DOS veces en Wallet (doble cobro).
 *
 * Antes de insertar, los call-sites llaman aquí: si ya existe una entry viva
 * para ese contract_payment_id, se reutiliza (y el caller re-enlaza el pago,
 * auto-reparando el enlace roto).
 *
 * A PROPÓSITO no es un unique en BD: hay flujos que crean varias entries por
 * pago legítimamente (p.ej. re-cobro tras un rechazo en validación) — por eso
 * se excluye status='rejected' y se devuelve la más antigua de las vivas.
 */
export async function findLiveWalletEntryForPayment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  companyId: string,
  contractPaymentId: string,
): Promise<string | null> {
  try {
    const { data, error } = await client
      .from("wallet_entries")
      .select("id")
      .eq("company_id", companyId)
      .eq("contract_payment_id", contractPaymentId)
      .neq("status", "rejected")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[wallet/entry-for-payment] lookup falló:", error.message);
      return null; // fail-open al comportamiento anterior (sin guarda)
    }
    return (data as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.error("[wallet/entry-for-payment] lookup falló:", e);
    return null; // fail-open al comportamiento anterior (sin guarda)
  }
}
