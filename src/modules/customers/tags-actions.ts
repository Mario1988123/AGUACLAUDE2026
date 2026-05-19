"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export interface CustomerTag {
  id: string;
  label: string;
  color: string;
}

export type TagColor =
  | "slate"
  | "red"
  | "amber"
  | "emerald"
  | "blue"
  | "violet"
  | "pink";

const tagSchema = z.object({
  id: z.string().uuid().nullish(),
  label: z.string().trim().min(1).max(40),
  color: z
    .enum(["slate", "red", "amber", "emerald", "blue", "violet", "pink"])
    .default("slate"),
});

export async function listTagsCatalog(): Promise<CustomerTag[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data } = await admin
      .from("customer_tag_catalog")
      .select("id, label, color")
      .eq("company_id", session.company_id)
      .order("label");
    return (data ?? []) as CustomerTag[];
  } catch {
    return [];
  }
}

export async function listCustomerTags(customerId: string): Promise<CustomerTag[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  try {
    const { data } = await admin
      .from("customer_tags")
      .select("tag_id, customer_tag_catalog!inner(id, label, color)")
      .eq("customer_id", customerId);
    type Row = { customer_tag_catalog: { id: string; label: string; color: string } };
    return ((data ?? []) as Row[]).map((r) => r.customer_tag_catalog);
  } catch {
    return [];
  }
}

function friendlyTableMissing(rawMsg: string): string {
  if (
    /could not find the table|relation .* does not exist|schema cache/i.test(
      rawMsg,
    )
  ) {
    return "Falta aplicar la migración 20260527110000_customer_tags_churn.sql en Supabase. Pídeselo al administrador del sistema.";
  }
  return rawMsg;
}

export async function upsertTagAction(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) return { ok: false, error: "Solo admin / dir. comercial" };
    const parsed = parseOrFriendly(tagSchema, input, "Etiqueta");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    if (parsed.id) {
      const r = await admin
        .from("customer_tag_catalog")
        .update({ label: parsed.label, color: parsed.color })
        .eq("id", parsed.id);
      if (r.error)
        return { ok: false, error: friendlyTableMissing(r.error.message) };
      revalidatePath("/configuracion/clientes");
      return { ok: true, id: parsed.id };
    } else {
      const { data, error } = await admin
        .from("customer_tag_catalog")
        .insert({
          company_id: session.company_id,
          label: parsed.label,
          color: parsed.color,
        })
        .select("id")
        .single();
      if (error)
        return { ok: false, error: friendlyTableMissing(error.message) };
      revalidatePath("/configuracion/clientes");
      return { ok: true, id: (data as { id: string }).id };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? friendlyTableMissing(err.message) : "Error desconocido",
    };
  }
}

export async function deleteTagAction(
  tagId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const allowed =
      session.is_superadmin ||
      session.roles.includes("company_admin") ||
      session.roles.includes("commercial_director");
    if (!allowed) return { ok: false, error: "Solo admin / dir. comercial" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("customer_tag_catalog")
      .delete()
      .eq("id", tagId)
      .eq("company_id", session.company_id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/configuracion/clientes");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}

export async function toggleCustomerTagAction(input: {
  customer_id: string;
  tag_id: string;
  attach: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    if (input.attach) {
      const { error } = await admin
        .from("customer_tags")
        .upsert({
          customer_id: input.customer_id,
          tag_id: input.tag_id,
          assigned_by: session.user_id,
        });
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await admin
        .from("customer_tags")
        .delete()
        .eq("customer_id", input.customer_id)
        .eq("tag_id", input.tag_id);
      if (error) return { ok: false, error: error.message };
    }
    revalidatePath(`/clientes/${input.customer_id}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Error desconocido",
    };
  }
}
