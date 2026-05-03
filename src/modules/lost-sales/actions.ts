"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

/**
 * Asigna una venta perdida a un comercial para que intente recuperarla.
 * No crea tabla nueva: usa columnas ya existentes en lost_sales.
 */
export async function assignRecoveryAction(lostSaleId: string, userId: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("lost_sales")
    .update({
      assigned_recovery_user_id: userId || null,
      recovery_assigned_at: userId ? new Date().toISOString() : null,
    })
    .eq("id", lostSaleId);
  revalidatePath("/ventas-perdidas");
}

/**
 * Reabre una venta perdida como lead nuevo:
 *  - Si la venta perdida tiene lead_id, intenta restaurar ese lead a 'new' y
 *    volver a la cartera (sin crear nada).
 *  - Marca la venta perdida como recovered + recovered_to_lead_id.
 */
export async function reopenLostSaleAction(lostSaleId: string) {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const { data: ls } = await supabase
    .from("lost_sales")
    .select("id, lead_id, is_recovered, company_id")
    .eq("id", lostSaleId)
    .single();
  if (!ls) throw new Error("No encontrada");
  const row = ls as { id: string; lead_id: string | null; is_recovered: boolean; company_id: string };
  if (row.is_recovered) throw new Error("Ya recuperada");
  if (!row.lead_id) throw new Error("Esta venta perdida no tiene lead asociado");

  // Recuperar tags actuales para añadir "reabierto" sin perder los existentes
  const { data: leadRow } = await supabase
    .from("leads")
    .select("tags")
    .eq("id", row.lead_id)
    .single();
  const currentTags = ((leadRow as { tags: string[] | null } | null)?.tags ?? []) as string[];
  const nextTags = currentTags.includes("reabierto")
    ? currentTags
    : [...currentTags, "reabierto"];

  await supabase
    .from("leads")
    .update({
      status: "new",
      lost_at: null,
      lost_reason: null,
      expired_at: null,
      // Liberar la asignación: queda sin asignar para que admin/director lo
      // reasigne al comercial que toque.
      assigned_user_id: null,
      assigned_at: null,
      tags: nextTags,
    })
    .eq("id", row.lead_id);

  await supabase
    .from("lost_sales")
    .update({
      is_recovered: true,
      recovered_at: new Date().toISOString(),
      recovered_to_lead_id: row.lead_id,
    })
    .eq("id", row.id);

  await supabase.from("events").insert({
    company_id: row.company_id,
    subject_type: "lead",
    subject_id: row.lead_id,
    kind: "lead.reopened_from_lost",
    payload: { lost_sale_id: row.id },
    actor_user_id: session.user_id,
  });

  revalidatePath("/ventas-perdidas");
  revalidatePath("/leads");
  revalidatePath(`/leads/${row.lead_id}`);
}

/**
 * Marca una venta perdida como recuperada manualmente sin reabrir el lead
 * (usado cuando ya se ha generado un nuevo lead/cliente en otro sitio).
 */
export async function markRecoveredAction(lostSaleId: string) {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  await supabase
    .from("lost_sales")
    .update({ is_recovered: true, recovered_at: new Date().toISOString() })
    .eq("id", lostSaleId);
  revalidatePath("/ventas-perdidas");
}
