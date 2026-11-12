"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  esSoloTecnico,
  listarClientesPendientes,
  type MotivoPendiente,
} from "@/shared/lib/auth/role-scope";

export interface ClientePendienteItem {
  id: string;
  nombre: string;
  telefono: string | null;
  poblacion: string | null;
  direccion: string | null;
  lat: number | null;
  lng: number | null;
  motivos: MotivoPendiente[];
}

/**
 * "Mis clientes" del técnico (2026-11-12, D3+D4): solo los que tienen un
 * mantenimiento o una instalación asignados a él sin cerrar, o cerrados hace
 * menos de 24 h. Lee con admin filtrando SIEMPRE por company_id y por los ids
 * que salen de SUS trabajos.
 */
export async function listarMisClientesPendientes(): Promise<ClientePendienteItem[]> {
  const session = await requireSession();
  if (!session.company_id || !esSoloTecnico(session)) return [];
  const pendientes = await listarClientesPendientes(session);
  const ids = Array.from(pendientes.keys());
  if (ids.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const [cRes, aRes] = await Promise.all([
    admin
      .from("customers")
      .select("id, party_kind, legal_name, trade_name, first_name, last_name, phone_primary")
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .in("id", ids),
    admin
      .from("addresses")
      .select("customer_id, is_primary, street_type, street, street_number, postal_code, city, latitude, longitude")
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .in("customer_id", ids)
      .order("is_primary", { ascending: false }),
  ]);
  type A = {
    customer_id: string;
    street_type: string | null;
    street: string | null;
    street_number: string | null;
    postal_code: string | null;
    city: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  const dir = new Map<string, A>();
  for (const a of (aRes.data ?? []) as A[]) {
    if (!dir.has(a.customer_id)) dir.set(a.customer_id, a);
  }
  type C = {
    id: string;
    party_kind: string;
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
    phone_primary: string | null;
  };
  const items: ClientePendienteItem[] = ((cRes.data ?? []) as C[]).map((c) => {
    const a = dir.get(c.id);
    const nombre =
      c.party_kind === "company"
        ? c.trade_name || c.legal_name || "Sin nombre"
        : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Sin nombre";
    const direccion = a
      ? [a.street_type, a.street, a.street_number, a.postal_code, a.city].filter(Boolean).join(" ")
      : null;
    return {
      id: c.id,
      nombre,
      telefono: c.phone_primary,
      poblacion: a?.city ?? null,
      direccion: direccion || null,
      lat: a?.latitude ?? null,
      lng: a?.longitude ?? null,
      motivos: pendientes.get(c.id) ?? [],
    };
  });
  // Primero el trabajo más antiguo sin cerrar.
  return items.sort((x, y) =>
    (x.motivos[0]?.fecha ?? "9999").localeCompare(y.motivos[0]?.fecha ?? "9999"),
  );
}
