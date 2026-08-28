"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { addressUpsertSchema, type AddressKind, type StreetType } from "./schemas";
import { toActionError } from "@/shared/lib/actions/safe-error";

export interface AddressRow {
  id: string;
  lead_id: string | null;
  customer_id: string | null;
  kind: AddressKind;
  label: string | null;
  is_primary: boolean;
  contact_name: string | null;
  contact_phone: string | null;
  street_type: StreetType;
  street: string;
  street_number: string | null;
  portal: string | null;
  floor: string | null;
  door: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
}

export async function listAddresses(filter: {
  lead_id?: string;
  customer_id?: string;
}): Promise<AddressRow[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let q = supabase
    .from("addresses")
    .select("*")
    .is("deleted_at", null)
    .order("is_primary", { ascending: false })
    .order("created_at");
  if (filter.lead_id) q = q.eq("lead_id", filter.lead_id);
  if (filter.customer_id) q = q.eq("customer_id", filter.customer_id);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AddressRow[];
}

export async function upsertAddressAction(input: unknown) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");

  // Parse Zod con safeParse para devolver mensaje legible en vez de
  // ZodError opaco que en producción aparece como digest.
  const result = addressUpsertSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join(".") ?? "campo";
    const msg = first?.message ?? "Datos inválidos";
    console.error("[upsertAddress] Zod failed:", JSON.stringify(result.error.issues));
    throw new Error(`${path}: ${msg}`);
  }
  const parsed = result.data;

  // Admin client: la policy addresses_insert/update por scope puede
  // bloquear silenciosamente al usuario actual según rol/scope. Antes
  // throwaba sin mensaje útil → digest "Server Components render".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Geocoding automático server-side: si vienen lat/lng vacíos pero hay
  // calle + ciudad mínimas, intentamos geocodificar con Nominatim. No
  // bloqueante: si falla, se guarda sin coords (el técnico lo verá luego).
  let lat = parsed.latitude;
  let lng = parsed.longitude;
  let geoSource: string | null = null;
  if (lat == null && lng == null && parsed.street && parsed.city) {
    try {
      const { forwardGeocodeAction } = await import("@/shared/lib/geocoding/actions");
      const queryParts = [
        parsed.street_type,
        parsed.street,
        parsed.street_number,
        parsed.postal_code,
        parsed.city,
        parsed.province,
        "España",
      ].filter(Boolean);
      const r = await forwardGeocodeAction(queryParts.join(", "));
      if (r) {
        lat = r.lat;
        lng = r.lng;
        geoSource = "geocoded";
      }
    } catch (e) {
      console.error("[upsertAddress] geocode falló:", e);
    }
  } else if (lat != null && lng != null) {
    geoSource = "user_pin";
  }

  const payload = {
    company_id: session.company_id,
    lead_id: parsed.lead_id || null,
    customer_id: parsed.customer_id || null,
    kind: parsed.kind,
    label: parsed.label || null,
    is_primary: parsed.is_primary,
    contact_name: parsed.contact_name || null,
    contact_phone: parsed.contact_phone || null,
    street_type: parsed.street_type,
    street: parsed.street,
    street_number: parsed.street_number || null,
    portal: parsed.portal || null,
    floor: parsed.floor || null,
    door: parsed.door || null,
    postal_code: parsed.postal_code || null,
    city: parsed.city || null,
    province: parsed.province || null,
    latitude: lat,
    longitude: lng,
    geo_source: geoSource,
    notes: parsed.notes || null,
  };

  // ORDEN IMPORTANTE (fix 2026-08-28): desmarcar las OTRAS primarias va
  // ANTES de guardar, no después. Hay un índice único parcial
  // `uniq_address_primary_per_customer` (y su gemelo por lead) sobre
  // (customer_id) where is_primary and deleted_at is null. Al guardar una
  // segunda dirección marcada como principal, el INSERT chocaba con la
  // primaria que aún seguía marcada y el usuario veía el error crudo de
  // Postgres: "duplicate key value violates unique constraint
  // uniq_address_primary_per_customer". Desmarcando primero, el índice
  // nunca ve dos primarias a la vez.
  if (parsed.is_primary) {
    const notMe = parsed.id ?? "00000000-0000-0000-0000-000000000000";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let unmark: any = null;
    if (parsed.customer_id) {
      unmark = await admin
        .from("addresses")
        .update({ is_primary: false })
        .eq("company_id", session.company_id)
        .eq("customer_id", parsed.customer_id)
        .neq("id", notMe)
        .is("deleted_at", null);
    } else if (parsed.lead_id) {
      unmark = await admin
        .from("addresses")
        .update({ is_primary: false })
        .eq("company_id", session.company_id)
        .eq("lead_id", parsed.lead_id)
        .neq("id", notMe)
        .is("deleted_at", null);
    }
    // Si esto falla NO seguimos: el guardado chocaría con el índice único y
    // el usuario vería otra vez el error críptico. Mejor un mensaje claro.
    if (unmark?.error) {
      console.error("[upsertAddress] desmarcar primary falló:", unmark.error.message);
      throw new Error(
        `No se pudo cambiar la dirección principal: ${unmark.error.message}`,
      );
    }
  }

  if (parsed.id) {
    const { error } = await admin
      .from("addresses")
      .update(payload)
      .eq("id", parsed.id);
    if (error) {
      console.error("[upsertAddress] UPDATE failed:", error.message);
      throw new Error(`No se pudo actualizar la dirección: ${error.message}`);
    }
  } else {
    const { error } = await admin.from("addresses").insert(payload);
    if (error) {
      console.error("[upsertAddress] INSERT failed:", error.message);
      throw new Error(`No se pudo crear la dirección: ${error.message}`);
    }
  }

  if (parsed.customer_id) revalidatePath(`/clientes/${parsed.customer_id}`);
  if (parsed.lead_id) revalidatePath(`/leads/${parsed.lead_id}`);
}

export async function deleteAddressAction(id: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Usuario sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { error } = await supabase
    .from("addresses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ============================================================================
// Safe wrappers (result pattern) — 2026-05-20
// ============================================================================

export async function upsertAddressSafeAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await upsertAddressAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}

export async function deleteAddressSafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteAddressAction(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toActionError(e) };
  }
}
