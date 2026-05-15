"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { parseOrFriendly } from "@/shared/lib/zod-friendly";

export interface ChildRow {
  id: string;
  child_name: string | null;
  birth_date: string;
  sex: "M" | "F" | "X" | null;
  notes: string | null;
}

const schema = z.object({
  id: z.string().uuid().optional(),
  child_name: z.string().optional().nullable(),
  birth_date: z.string().min(1, "Fecha de nacimiento obligatoria"),
  sex: z.enum(["M", "F", "X"]).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function listMyChildren(): Promise<ChildRow[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  let res = await admin
    .from("employee_children")
    .select("id, child_name, birth_date, sex, notes")
    .eq("user_id", session.user_id)
    .order("birth_date", { ascending: false });
  if (
    res.error &&
    /sex|schema cache|Could not find/i.test(res.error.message ?? "")
  ) {
    res = await admin
      .from("employee_children")
      .select("id, child_name, birth_date, notes")
      .eq("user_id", session.user_id)
      .order("birth_date", { ascending: false });
  }
  if (res.error) return [];
  return (res.data ?? []) as ChildRow[];
}

/** Para validación interna: edad del menor más joven en una fecha. */
export async function getMyYoungestChildAgeAt(
  userId: string,
  dateIso: string,
): Promise<number | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("employee_children")
    .select("birth_date")
    .eq("user_id", userId)
    .order("birth_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const r = data as { birth_date?: string } | null;
  if (!r?.birth_date) return null;
  const birth = new Date(r.birth_date);
  const target = new Date(dateIso);
  let age = target.getFullYear() - birth.getFullYear();
  const m = target.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && target.getDate() < birth.getDate())) age--;
  return age;
}

export async function upsertChildAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const parsed = parseOrFriendly(schema, input, "Hijo");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const payload: Record<string, unknown> = {
      company_id: session.company_id,
      user_id: session.user_id,
      child_name: parsed.child_name?.trim() || null,
      birth_date: parsed.birth_date,
      sex: parsed.sex ?? null,
      notes: parsed.notes?.trim() || null,
    };
    const upsertOnce = async (p: Record<string, unknown>) => {
      if (parsed.id) {
        return admin
          .from("employee_children")
          .update(p)
          .eq("id", parsed.id)
          .eq("user_id", session.user_id);
      }
      return admin.from("employee_children").insert(p);
    };
    let r = await upsertOnce(payload);
    if (r.error && /sex|schema cache|Could not find/i.test(r.error.message ?? "")) {
      delete payload.sex;
      r = await upsertOnce(payload);
    }
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/fichajes");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}

export async function deleteChildAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const r = await admin
      .from("employee_children")
      .delete()
      .eq("id", id)
      .eq("user_id", session.user_id);
    if (r.error) return { ok: false, error: r.error.message };
    revalidatePath("/fichajes");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error" };
  }
}
