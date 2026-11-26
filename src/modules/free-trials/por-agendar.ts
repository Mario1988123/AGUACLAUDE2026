import "server-only";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { leerDisponibilidad, type Disponibilidad } from "./disponibilidad";
import { PRUEBAS_GESTIONADAS_DESDE } from "./corte-pruebas";

/**
 * Pruebas gratuitas PEDIDAS y sin agendar (estado draft) para la agenda y
 * el dashboard del admin y del director técnico (Mario 2026-11-26).
 * Solo draft: las 'scheduled' ya tienen fecha (aunque sea pasada).
 * Ordenadas por antigüedad (la más vieja primero); > 30 días = «antigua».
 *
 * Admin client con company_id: el permiso (puedeAgendarPrueba) lo comprueba
 * quien llama.
 */
export interface PruebaPorAgendar {
  id: string;
  reference_code: string | null;
  created_at: string;
  dias_desde_peticion: number;
  antigua: boolean;
  cliente: string;
  cliente_href: string | null;
  comercial: string | null;
  productos: string[];
  disponibilidad: Disponibilidad | null;
}

export const DIAS_PRUEBA_ANTIGUA = 30;

function nombreParte(p: {
  party_kind?: string | null;
  legal_name?: string | null;
  trade_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
} | null): string | null {
  if (!p) return null;
  if (p.party_kind === "company") return p.trade_name || p.legal_name || null;
  return `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || null;
}

export async function contarPruebasPorAgendar(companyId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { count } = await admin
    .from("free_trials")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "draft")
    // Las anteriores se gestionaron fuera de la app (corte-pruebas.ts).
    .gte("created_at", PRUEBAS_GESTIONADAS_DESDE)
    .is("deleted_at", null);
  return count ?? 0;
}

export async function listarPruebasPorAgendar(
  companyId: string,
  limite = 60,
): Promise<{ total: number; items: PruebaPorAgendar[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data, count, error } = await admin
    .from("free_trials")
    .select(
      "id, reference_code, created_at, created_by, lead_id, customer_id, disponibilidad, customers(party_kind, legal_name, trade_name, first_name, last_name), leads(party_kind, legal_name, trade_name, first_name, last_name)",
      { count: "exact" },
    )
    .eq("company_id", companyId)
    .eq("status", "draft")
    // Las anteriores se gestionaron fuera de la app (corte-pruebas.ts).
    .gte("created_at", PRUEBAS_GESTIONADAS_DESDE)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(limite);
  if (error) throw error;
  const filas = (data ?? []) as Array<{
    id: string;
    reference_code: string | null;
    created_at: string;
    created_by: string | null;
    lead_id: string | null;
    customer_id: string | null;
    disponibilidad: unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    customers: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    leads: any;
  }>;
  if (filas.length === 0) return { total: count ?? 0, items: [] };

  const ids = filas.map((f) => f.id);
  const creadores = Array.from(
    new Set(filas.map((f) => f.created_by).filter((x): x is string => !!x)),
  );
  const [itemsRes, perfilesRes] = await Promise.all([
    admin
      .from("free_trial_items")
      .select("free_trial_id, product_name_snapshot, quantity")
      .in("free_trial_id", ids),
    creadores.length > 0
      ? admin.from("user_profiles").select("user_id, full_name").in("user_id", creadores)
      : Promise.resolve({ data: [] }),
  ]);
  const productos = new Map<string, string[]>();
  for (const it of (itemsRes.data ?? []) as Array<{
    free_trial_id: string;
    product_name_snapshot: string | null;
    quantity: number | null;
  }>) {
    const lista = productos.get(it.free_trial_id) ?? [];
    const nombre = it.product_name_snapshot || "Equipo";
    lista.push((it.quantity ?? 1) > 1 ? `${nombre} ×${it.quantity}` : nombre);
    productos.set(it.free_trial_id, lista);
  }
  const nombres = new Map<string, string>();
  for (const p of (perfilesRes.data ?? []) as Array<{
    user_id: string;
    full_name: string | null;
  }>) {
    if (p.full_name) nombres.set(p.user_id, p.full_name);
  }

  const ahora = Date.now();
  const items = filas.map((f) => {
    const dias = Math.max(0, Math.floor((ahora - new Date(f.created_at).getTime()) / 86_400_000));
    const cliente =
      nombreParte(Array.isArray(f.leads) ? f.leads[0] : f.leads) ??
      nombreParte(Array.isArray(f.customers) ? f.customers[0] : f.customers) ??
      "Sin nombre";
    return {
      id: f.id,
      reference_code: f.reference_code,
      created_at: f.created_at,
      dias_desde_peticion: dias,
      antigua: dias > DIAS_PRUEBA_ANTIGUA,
      cliente,
      cliente_href: f.lead_id
        ? `/leads/${f.lead_id}`
        : f.customer_id
          ? `/clientes/${f.customer_id}`
          : null,
      comercial: f.created_by ? (nombres.get(f.created_by) ?? null) : null,
      productos: productos.get(f.id) ?? [],
      disponibilidad: leerDisponibilidad(f.disponibilidad),
    };
  });
  return { total: count ?? items.length, items };
}
