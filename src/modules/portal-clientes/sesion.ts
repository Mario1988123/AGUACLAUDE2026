import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";

export interface SesionPortal {
  user_id: string;
  cuenta_id: string;
  company_id: string;
  customer_id: string;
  usuario: string;
}

/**
 * Busca la cuenta de portal ACTIVA de un usuario de Auth. Devuelve null si no
 * es cliente del portal, si está desactivado o si el cliente se borró.
 */
export async function cuentaPortalDeUsuario(userId: string): Promise<SesionPortal | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: cuenta } = await admin
    .from("customer_portal_accounts")
    .select("id, company_id, customer_id, login_tax_id, status")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cuenta || cuenta.status !== "active") return null;

  const { data: cliente } = await admin
    .from("customers")
    .select("id, deleted_at")
    .eq("id", cuenta.customer_id)
    .eq("company_id", cuenta.company_id)
    .maybeSingle();
  if (!cliente || cliente.deleted_at) return null;

  return {
    user_id: userId,
    cuenta_id: cuenta.id,
    company_id: cuenta.company_id,
    customer_id: cuenta.customer_id,
    usuario: cuenta.login_tax_id,
  };
}

/** ¿Este usuario de Auth tiene (o tuvo) cuenta de portal, aunque esté desactivada? */
export async function esUsuarioPortal(userId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("customer_portal_accounts")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}

/**
 * Para las páginas privadas del portal. Sin sesión → /portal/entrar. Con sesión
 * de empleado (sin cuenta de portal) → al CRM. Cuenta desactivada → cierra
 * sesión y avisa.
 */
export const requireSesionPortal = cache(async (): Promise<SesionPortal> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/entrar");

  const sesion = await cuentaPortalDeUsuario(user.id);
  if (sesion) return sesion;

  if (await esUsuarioPortal(user.id)) {
    redirect("/portal/salir?motivo=desactivado");
  }
  redirect("/");
});
