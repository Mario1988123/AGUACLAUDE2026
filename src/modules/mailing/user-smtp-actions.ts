"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { encryptSecret } from "./encryption";

export interface UserSmtpRow {
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_secure: boolean | null;
  smtp_provider: string | null;
  from_email: string | null;
  from_name: string | null;
  signature_html: string | null;
  has_password: boolean;
}

/** Lee la config SMTP de un usuario (admin: cualquiera; usuario: solo el suyo). */
export async function getUserSmtpAction(targetUserId: string): Promise<UserSmtpRow | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  const isAdmin = session.is_superadmin || session.roles.includes("company_admin");
  if (!isAdmin && targetUserId !== session.user_id) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("email_user_settings")
    .select(
      "smtp_host, smtp_port, smtp_user, smtp_password_enc, smtp_secure, smtp_provider, from_email, from_name, signature_html",
    )
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (!data) {
    return {
      smtp_host: null,
      smtp_port: null,
      smtp_user: null,
      smtp_secure: null,
      smtp_provider: null,
      from_email: null,
      from_name: null,
      signature_html: null,
      has_password: false,
    };
  }
  return {
    smtp_host: data.smtp_host,
    smtp_port: data.smtp_port,
    smtp_user: data.smtp_user,
    smtp_secure: data.smtp_secure,
    smtp_provider: data.smtp_provider,
    from_email: data.from_email,
    from_name: data.from_name,
    signature_html: data.signature_html,
    has_password: Boolean(data.smtp_password_enc),
  };
}

export interface SetUserSmtpInput {
  user_id: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password?: string;
  smtp_secure: boolean;
  from_email: string;
  from_name?: string;
  smtp_provider?: string;
}

export async function setUserSmtpAction(
  input: SetUserSmtpInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    const isAdmin = session.is_superadmin || session.roles.includes("company_admin");
    if (!isAdmin && input.user_id !== session.user_id) {
      return { ok: false, error: "Solo puedes configurar tu propio SMTP" };
    }
    if (!input.from_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.from_email)) {
      return { ok: false, error: "Email remitente inválido" };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: existing } = await admin
      .from("email_user_settings")
      .select("user_id")
      .eq("user_id", input.user_id)
      .maybeSingle();

    const payload: Record<string, unknown> = {
      user_id: input.user_id,
      company_id: session.company_id,
      from_email: input.from_email,
      from_name: input.from_name ?? null,
      smtp_host: input.smtp_host || null,
      smtp_port: input.smtp_port || 587,
      smtp_user: input.smtp_user || null,
      smtp_secure: input.smtp_secure,
      smtp_provider: input.smtp_provider ?? null,
      smtp_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (input.smtp_password) {
      payload.smtp_password_enc = encryptSecret(input.smtp_password);
    }

    const { error } = existing
      ? await admin.from("email_user_settings").update(payload).eq("user_id", input.user_id)
      : await admin.from("email_user_settings").insert(payload);
    if (error) return { ok: false, error: error.message };

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

// Wrapper async sobre testSmtpAction de actions.ts.
// "use server" no permite re-exports; tiene que ser una función async declarada.
import type { TestSmtpInput } from "./actions";

export async function testSmtpAction(
  input: TestSmtpInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { testSmtpAction: inner } = await import("./actions");
  return inner(input);
}
