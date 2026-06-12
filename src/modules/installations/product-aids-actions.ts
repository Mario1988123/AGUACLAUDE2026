"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface InstallationProductAid {
  product_id: string;
  product_name: string;
  manual_url: string | null;
  notes: string | null;
}

/**
 * Devuelve ayudas a la instalación (manual PDF + notas) por producto de
 * una instalación concreta. Se muestra al instalador en el wizard.
 */
export async function getInstallationProductAids(
  installationId: string,
): Promise<InstallationProductAid[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    // 1) Items de la instalación. SEGURIDAD: admin salta RLS → filtrar por
    // company_id (installation_items lo lleva); si la instalación no es tuya, vacío.
    const { data: items } = await admin
      .from("installation_items")
      .select("product_id, product_name_snapshot")
      .eq("installation_id", installationId)
      .eq("company_id", session.company_id);
    type IT = { product_id: string; product_name_snapshot: string };
    const list = (items ?? []) as IT[];
    if (list.length === 0) return [];
    const productIds = Array.from(new Set(list.map((i) => i.product_id)));
    // 2) Productos con sus ayudas
    const { data: products } = await admin
      .from("products")
      .select("id, name, installation_manual_url, installation_notes")
      .in("id", productIds);
    type P = {
      id: string;
      name: string;
      installation_manual_url: string | null;
      installation_notes: string | null;
    };
    const pmap = new Map(((products ?? []) as P[]).map((p) => [p.id, p]));
    // 3) Devolver solo los que tengan ALGO (manual o notas).
    return list
      .map((it) => {
        const p = pmap.get(it.product_id);
        if (!p) return null;
        if (!p.installation_manual_url && !p.installation_notes) return null;
        return {
          product_id: it.product_id,
          product_name: it.product_name_snapshot || p.name,
          manual_url: p.installation_manual_url,
          notes: p.installation_notes,
        };
      })
      .filter((v): v is InstallationProductAid => v !== null);
  } catch {
    return [];
  }
}
