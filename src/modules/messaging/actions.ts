"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import type { MessageTemplate } from "./templates";

/**
 * Lista plantillas de la empresa actual. Si no hay ninguna, siembra los
 * defaults vía RPC y vuelve a leer.
 */
export async function listMessageTemplates(): Promise<MessageTemplate[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let { data } = await supabase
    .from("message_templates")
    .select("id, key, label, channel, subject, body, sort_order, is_active")
    .eq("company_id", session.company_id)
    .eq("is_active", true)
    .order("sort_order");
  if (!data || (data as Array<unknown>).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    await admin.rpc("seed_default_message_templates", { p_company_id: session.company_id });
    const r = await supabase
      .from("message_templates")
      .select("id, key, label, channel, subject, body, sort_order, is_active")
      .eq("company_id", session.company_id)
      .eq("is_active", true)
      .order("sort_order");
    data = r.data;
  }
  return ((data ?? []) as Array<{
    id: string;
    key: string;
    label: string;
    channel: "whatsapp" | "email" | "any";
    subject: string | null;
    body: string;
  }>).map((t) => ({
    key: t.key,
    label: t.label,
    channel: t.channel,
    subject: t.subject ?? undefined,
    body: t.body,
  }));
}

async function ensureAdmin() {
  const session = await requireSession();
  if (!session.is_superadmin && !session.roles.includes("company_admin"))
    throw new Error("Solo admin");
  return session;
}

export interface MessageTemplateRow {
  id: string;
  key: string;
  label: string;
  channel: "whatsapp" | "email" | "any";
  subject: string | null;
  body: string;
  sort_order: number;
  is_active: boolean;
}

export async function listMessageTemplatesAdmin(): Promise<MessageTemplateRow[]> {
  const session = await ensureAdmin();
  if (!session.company_id) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let { data } = await supabase
    .from("message_templates")
    .select("id, key, label, channel, subject, body, sort_order, is_active")
    .eq("company_id", session.company_id)
    .order("sort_order");
  if (!data || (data as Array<unknown>).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    await admin.rpc("seed_default_message_templates", { p_company_id: session.company_id });
    const r = await supabase
      .from("message_templates")
      .select("id, key, label, channel, subject, body, sort_order, is_active")
      .eq("company_id", session.company_id)
      .order("sort_order");
    data = r.data;
  }
  return (data ?? []) as MessageTemplateRow[];
}

export async function upsertMessageTemplateAction(input: {
  id?: string;
  key: string;
  label: string;
  channel: "whatsapp" | "email" | "any";
  subject?: string;
  body: string;
  sort_order?: number;
}): Promise<void> {
  const session = await ensureAdmin();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const payload = {
    company_id: session.company_id,
    key: input.key.trim(),
    label: input.label.trim(),
    channel: input.channel,
    subject: input.subject ?? null,
    body: input.body,
    sort_order: input.sort_order ?? 0,
    is_active: true,
  };
  if (input.id) {
    await admin.from("message_templates").update(payload).eq("id", input.id);
  } else {
    await admin.from("message_templates").insert(payload);
  }
  revalidatePath("/configuracion/plantillas");
}

export async function deleteMessageTemplateAction(id: string): Promise<void> {
  await ensureAdmin();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  await admin.from("message_templates").update({ is_active: false }).eq("id", id);
  revalidatePath("/configuracion/plantillas");
}

export async function upsertMessageTemplateSafeAction(input: {
  id?: string;
  key: string;
  label: string;
  channel: "whatsapp" | "email" | "any";
  subject?: string;
  body: string;
  sort_order?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await upsertMessageTemplateAction(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteMessageTemplateSafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteMessageTemplateAction(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
