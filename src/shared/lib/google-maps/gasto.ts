import "server-only";

import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";

/**
 * Suma el gasto (en USD) de Google Maps de una empresa desde `sinceIso`.
 *
 * Antes se hacía con un select plano: PostgREST corta en 1000 filas sin dar
 * error, así que a partir de la llamada 1001 del mes el tope de gasto dejaba
 * de contar y la alerta no saltaba. Aquí se lee por tramos.
 *
 * No es "use server" a propósito: recibe `companyId` por parámetro y no debe
 * quedar expuesta como server action.
 */
export async function sumarGastoGoogleUsd(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  companyId: string,
  sinceIso: string,
): Promise<number> {
  const rows = await fetchAllRows<{ cost_micro_usd: number | null }>(
    (from, to) =>
      admin
        .from("google_api_usage")
        .select("cost_micro_usd")
        .eq("company_id", companyId)
        .eq("success", true)
        .gte("called_at", sinceIso)
        .order("id", { ascending: true })
        .range(from, to),
    { maxRows: 500000, label: "google_api_usage:gasto" },
  );
  const micro = rows.reduce((s, r) => s + Number(r.cost_micro_usd ?? 0), 0);
  return micro / 1_000_000;
}
