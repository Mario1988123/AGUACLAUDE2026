"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { addressUpsertSchema, type AddressKind, type StreetType } from "./schemas";

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
    latitude: parsed.latitude,
    longitude: parsed.longitude,
    notes: parsed.notes || null,
  };

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

  // Si esta es marcada como primaria, desmarcar las demás del mismo dueño
  if (parsed.is_primary) {
    try {
      if (parsed.customer_id) {
        await admin
          .from("addresses")
          .update({ is_primary: false })
          .eq("customer_id", parsed.customer_id)
          .neq("id", parsed.id ?? "00000000-0000-0000-0000-000000000000")
          .is("deleted_at", null);
      } else if (parsed.lead_id) {
        await admin
          .from("addresses")
          .update({ is_primary: false })
          .eq("lead_id", parsed.lead_id)
          .neq("id", parsed.id ?? "00000000-0000-0000-0000-000000000000")
          .is("deleted_at", null);
      }
    } catch (e) {
      console.error("[upsertAddress] desmarcar primary falló:", e);
      /* no bloqueante */
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
