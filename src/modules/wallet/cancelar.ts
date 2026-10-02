import "server-only";

/**
 * Cancelación de cobros del wallet (C6).
 *
 * `cancelled` no existía en el enum `app.wallet_entry_status`: el update
 * fallaba con 22P02 y, como nadie miraba el error, los cobros de un contrato
 * cancelado seguían "pendientes". La migración 20261002130000 añade el valor.
 * Mientras no esté aplicada, se cae a `rejected` con el motivo, que es un
 * estado válido y deja el cobro fuera de todo lo que cobra.
 */

function esValorEnumInvalido(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "22P02" || /invalid input value for enum/i.test(error.message ?? "");
}

export interface FiltroWallet {
  companyId: string;
  /** Un cobro concreto… */
  id?: string;
  /** …o todos los de un contrato. */
  contractId?: string;
  /** Solo los que estén en estos estados. */
  estados: string[];
}

/**
 * Pasa a `cancelled` (o `rejected` si el enum aún no lo tiene) los cobros
 * que casan con el filtro. Devuelve cuántos se tocaron. Lanza si falla.
 */
export async function cancelarCobrosWallet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  filtro: FiltroWallet,
  motivo: string,
  usuarioId: string | null,
): Promise<{ actualizados: number; estado: "cancelled" | "rejected" }> {
  if (!filtro.id && !filtro.contractId) throw new Error("Filtro de cobros vacío");
  const ejecutar = (estado: "cancelled" | "rejected") => {
    let q = admin
      .from("wallet_entries")
      .update({
        status: estado,
        rejected_reason: motivo,
        validated_at: new Date().toISOString(),
        validated_by_user_id: usuarioId,
      })
      .eq("company_id", filtro.companyId)
      .in("status", filtro.estados);
    if (filtro.id) q = q.eq("id", filtro.id);
    if (filtro.contractId) q = q.eq("contract_id", filtro.contractId);
    return q.select("id");
  };
  let estado: "cancelled" | "rejected" = "cancelled";
  let r = await ejecutar(estado);
  if (esValorEnumInvalido(r.error)) {
    estado = "rejected";
    r = await ejecutar(estado);
  }
  if (r.error) throw new Error(r.error.message);
  return { actualizados: ((r.data ?? []) as unknown[]).length, estado };
}
