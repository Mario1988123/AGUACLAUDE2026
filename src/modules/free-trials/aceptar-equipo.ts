/**
 * Qué equipo se queda el cliente al aceptar la prueba (Mario 2026-11-26).
 *
 *  - ALQUILER: solo los equipos marcados «Disponible en prueba gratuita» (la
 *    Esencial de pie y la de sobremesa). Si la empresa no ha marcado ninguno,
 *    los que tengan plan de alquiler.
 *  - COMPRA: cualquier equipo con precio de venta (plan contado activo).
 *
 * Y qué pasa con el equipo de prueba que ya está instalado:
 *  - «se_queda»:   se queda como está, definitivo;
 *  - «reinstalar»: se queda, pero hay que volver para fijarlo (reubicación);
 *  - «cambiar»:    quiere otro equipo: se retira el de prueba y, al firmar el
 *                  contrato, se crea la instalación del nuevo.
 *
 * Helpers de SERVIDOR con admin client (quien llama comprueba la sesión).
 */
import { ROL_PRUEBA_GRATUITA } from "./productos-prueba";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export type PlanQuedarse = "rental" | "cash";
export type DestinoEquipo = "se_queda" | "reinstalar" | "cambiar";

export interface EquipoQuedarse {
  id: string;
  nombre: string;
}

export async function equiposParaQuedarse(
  admin: Admin,
  companyId: string,
  plan: PlanQuedarse,
): Promise<EquipoQuedarse[]> {
  const { data: prods } = await admin
    .from("products")
    .select("id, name, roles")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("name")
    .limit(1000);
  const lista = (prods ?? []) as Array<{ id: string; name: string; roles: string[] | null }>;
  if (lista.length === 0) return [];
  const ids = lista.map((p) => p.id);
  const { data: planes } = await admin
    .from("product_pricing_plans")
    .select("product_id, total_price_cents, total_price_individual_cents")
    .in("product_id", ids)
    .eq("plan_type", plan)
    .eq("is_active", true);
  const conPlan = new Set<string>();
  for (const pl of (planes ?? []) as Array<{
    product_id: string;
    total_price_cents: number | null;
    total_price_individual_cents: number | null;
  }>) {
    if (plan === "cash") {
      const precio = pl.total_price_individual_cents ?? pl.total_price_cents ?? 0;
      if (precio > 0) conPlan.add(pl.product_id);
    } else {
      conPlan.add(pl.product_id);
    }
  }
  let elegidos: typeof lista;
  if (plan === "rental") {
    const marcados = lista.filter((p) => p.roles?.includes(ROL_PRUEBA_GRATUITA));
    elegidos = marcados.length > 0 ? marcados : lista.filter((p) => conPlan.has(p.id));
  } else {
    elegidos = lista.filter((p) => conPlan.has(p.id));
  }
  return elegidos.map((p) => ({ id: p.id, nombre: p.name.trim() }));
}
