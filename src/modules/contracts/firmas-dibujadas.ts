/**
 * Firma en persona: tienen que estar dibujadas en la pantalla la firma del
 * cliente y la del comercial (Mario 2026-11-26). Antes se podía pulsar
 * «Firmar» sin ninguna. La firma a distancia va por su propio camino.
 *
 * Helper de SERVIDOR con admin client; quien llama ya ha validado el contrato.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export async function firmasQueFaltan(
  admin: Admin,
  contractId: string,
): Promise<string[]> {
  const { data } = await admin
    .from("contract_signatures")
    .select("signer_role, signature_data_url")
    .eq("contract_id", contractId);
  const hechas = new Set(
    ((data ?? []) as Array<{ signer_role: string; signature_data_url: string | null }>)
      .filter((f) => !!f.signature_data_url)
      .map((f) => f.signer_role),
  );
  const faltan: string[] = [];
  if (!hechas.has("customer")) faltan.push("Firma del cliente");
  if (!hechas.has("representative")) faltan.push("Firma del comercial");
  return faltan;
}
