"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  createUninstallAction,
  completeUninstallNowAction,
  type EquipmentDisposition,
} from "./uninstall-actions";

// ============================================================================
// Flujo "Borrar cliente" (decisión 2026-06-16)
// ----------------------------------------------------------------------------
// Solo el administrador puede borrar clientes. Dos caminos:
//
//   1) Sin equipos (creado por error) → deleteEmptyCustomerAction: borra
//      directo escribiendo la palabra "borrar". No pasa por venta perdida.
//
//   2) Con equipo(s) → churnCustomerAction: por CADA equipo se decide:
//        · "keep"  (Caso A): lo compró y corta relación. El equipo se queda
//                  instalado (sabemos que es nuestro), se marca que rechaza
//                  mantenimientos. El cliente se conserva.
//        · "remove" (Caso B): alquiler/renting. Se retira la máquina con
//                  destino (almacén o perdida/rota/robada) y momento (ya
//                  hecha con fecha, o programada con técnico).
//      Tras decidir, el cliente pasa a Inactivo + Perdido y entra en
//      /ventas-perdidas. El borrado definitivo (anonimizar) se hace allí.
// ============================================================================

type Session = Awaited<ReturnType<typeof requireSession>>;

function isAdmin(session: Session): boolean {
  return session.is_superadmin || session.roles.includes("company_admin");
}

function confirmOk(word: string | null | undefined): boolean {
  return (word ?? "").trim().toLowerCase() === "borrar";
}

export interface CustomerEquipmentDecision {
  equipment_id: string;
  action: "keep" | "remove";
  /** Solo si action='remove'. Default 'warehouse'. */
  disposition?: EquipmentDisposition;
}

export interface ChurnCustomerInput {
  customer_id: string;
  confirm_word: string;
  decisions: CustomerEquipmentDecision[];
  /** Para los equipos 'remove' que vuelven a almacén. */
  destination_warehouse_id?: string | null;
  default_state?: "used" | "damaged" | null;
  /** Momento de la retirada de los 'remove'. */
  timing?: "already" | "schedule" | null;
  /** Si timing='already': fecha en que se desinstaló. */
  uninstalled_at?: string | null;
  /** Si timing='schedule': técnico + fecha programada. */
  technician_user_id?: string | null;
  scheduled_at?: string | null;
  /** Motivo de la baja (texto libre). */
  reason?: string | null;
  notes?: string | null;
}

/**
 * Da de baja a un cliente decidiendo equipo por equipo. Lo deja Inactivo +
 * Perdido y lo manda a /ventas-perdidas. NO borra al cliente (eso se hace
 * después desde venta perdida, anonimizando).
 */
export async function churnCustomerAction(
  input: ChurnCustomerInput,
): Promise<
  { ok: true; uninstall_installation_id: string | null } | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isAdmin(session)) {
      return { ok: false, error: "Solo el administrador puede borrar clientes" };
    }
    if (!confirmOk(input.confirm_word)) {
      return { ok: false, error: "Escribe la palabra «borrar» para confirmar" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // Cliente de la empresa
    const { data: cust } = await admin
      .from("customers")
      .select("id, company_id")
      .eq("id", input.customer_id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!cust) return { ok: false, error: "Cliente no encontrado" };

    // Equipos activos reales (filtra decisiones contra la realidad)
    const { data: activeEq } = await admin
      .from("customer_equipment")
      .select("id")
      .eq("customer_id", input.customer_id)
      .eq("company_id", session.company_id)
      .eq("is_active", true);
    const activeIds = new Set(
      ((activeEq ?? []) as Array<{ id: string }>).map((e) => e.id),
    );

    const removeDecisions = input.decisions.filter(
      (d) => d.action === "remove" && activeIds.has(d.equipment_id),
    );
    const keepDecisions = input.decisions.filter(
      (d) => d.action === "keep" && activeIds.has(d.equipment_id),
    );

    let uninstallInstallationId: string | null = null;

    // === CASO B: RETIRAR ===
    if (removeDecisions.length > 0) {
      const removeIds = removeDecisions.map((d) => d.equipment_id);
      const dispositions = removeDecisions.map((d) => ({
        equipment_id: d.equipment_id,
        disposition: (d.disposition ?? "warehouse") as EquipmentDisposition,
      }));
      const needsWarehouse = dispositions.some(
        (d) => d.disposition === "warehouse",
      );
      if (needsWarehouse && !input.destination_warehouse_id) {
        return {
          ok: false,
          error: "Falta el almacén destino para los equipos que vuelven a almacén",
        };
      }
      const timing = input.timing ?? "schedule";
      const created = await createUninstallAction({
        customer_id: input.customer_id,
        equipment_ids: removeIds,
        destination_warehouse_id: input.destination_warehouse_id ?? "",
        default_state: input.default_state ?? "used",
        // Si se programa → la fecha futura. Si ya está hecha → la fecha real.
        scheduled_at:
          timing === "schedule"
            ? input.scheduled_at ?? null
            : input.uninstalled_at ?? null,
        installer_user_id:
          timing === "schedule" ? input.technician_user_id ?? null : null,
        equipment_dispositions: dispositions,
        notes: input.notes ?? input.reason ?? null,
      });
      if (!created.ok) return { ok: false, error: created.error };
      uninstallInstallationId = created.installation_id;

      // Si ya estaba desinstalada → cerrar al momento (baja equipos + stock).
      if (timing === "already") {
        const done = await completeUninstallNowAction({
          installation_id: created.installation_id,
          completed_at: input.uninstalled_at ?? null,
        });
        if (!done.ok) {
          // No abortamos la baja del cliente por esto; queda la orden creada.
          console.error("[churn] complete now:", done.error);
        }
      }
    }

    // === CASO A: SE QUEDA (rechaza mantenimiento) ===
    if (keepDecisions.length > 0) {
      const stamp = new Date().toLocaleDateString("es-ES");
      for (const d of keepDecisions) {
        try {
          const { data: row } = await admin
            .from("customer_equipment")
            .select("notes")
            .eq("id", d.equipment_id)
            .maybeSingle();
          const prev = (row as { notes: string | null } | null)?.notes ?? "";
          if (prev.includes("rechaza mantenimientos")) continue;
          const tag = `⚠ Cliente dado de baja ${stamp} — conserva este equipo (comprado), rechaza mantenimientos.`;
          await admin
            .from("customer_equipment")
            .update({ notes: prev ? `${prev}\n${tag}` : tag })
            .eq("id", d.equipment_id);
        } catch {
          /* fail-soft */
        }
      }
    }

    // === Cancelar mantenimientos futuros del cliente ===
    try {
      await admin
        .from("maintenance_jobs")
        .update({ status: "cancelled" })
        .eq("customer_id", input.customer_id)
        .eq("company_id", session.company_id)
        .is("completed_at", null)
        .not("status", "in", "(completed,cancelled)");
    } catch {
      /* fail-soft */
    }

    // === Marcar el cliente como PERDIDO (inactivo + churn) ===
    const churnType: "removed" | "sold_no_relation" =
      removeDecisions.length > 0 ? "removed" : "sold_no_relation";
    const upd = await admin
      .from("customers")
      .update({
        is_active: false,
        churned_at: new Date().toISOString(),
        churn_type: churnType,
        churn_reason: input.reason ?? null,
      })
      .eq("id", input.customer_id)
      .eq("company_id", session.company_id);
    if (
      upd.error &&
      /churn|schema cache|Could not find/i.test(upd.error.message ?? "")
    ) {
      // Columnas churn aún no visibles en el cache → al menos desactivar.
      await admin
        .from("customers")
        .update({ is_active: false })
        .eq("id", input.customer_id)
        .eq("company_id", session.company_id);
    }

    // === Crear / actualizar fila en ventas perdidas ===
    await upsertCustomerLostSale(admin, {
      company_id: session.company_id,
      customer_id: input.customer_id,
      created_by: session.user_id,
      churnType,
      reason: input.reason ?? null,
    });

    // === Auditoría ===
    try {
      await admin.from("events").insert({
        company_id: session.company_id,
        subject_type: "customer",
        subject_id: input.customer_id,
        kind: "customer.churned",
        payload: {
          churn_type: churnType,
          removed: removeDecisions.map((d) => d.equipment_id),
          kept: keepDecisions.map((d) => d.equipment_id),
          uninstall_installation_id: uninstallInstallationId,
          timing: input.timing ?? null,
        },
        actor_user_id: session.user_id,
      });
    } catch {
      /* no-op */
    }

    revalidatePath("/clientes");
    revalidatePath(`/clientes/${input.customer_id}`);
    revalidatePath("/ventas-perdidas");
    return { ok: true, uninstall_installation_id: uninstallInstallationId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Borra directamente un cliente SIN equipos (creado por error). Requiere
 * escribir "borrar". No pasa por venta perdida. Si el borrado físico choca
 * con datos asociados (propuestas, contratos, facturas), avisa para usar el
 * flujo completo / RGPD.
 */
export async function deleteEmptyCustomerAction(input: {
  customer_id: string;
  confirm_word: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    if (!isAdmin(session)) {
      return { ok: false, error: "Solo el administrador puede borrar clientes" };
    }
    if (!confirmOk(input.confirm_word)) {
      return { ok: false, error: "Escribe la palabra «borrar» para confirmar" };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;
    const { data: cust } = await admin
      .from("customers")
      .select("id, company_id")
      .eq("id", input.customer_id)
      .eq("company_id", session.company_id)
      .maybeSingle();
    if (!cust) return { ok: false, error: "Cliente no encontrado" };

    // Este camino es SOLO para clientes sin equipos. Si tiene equipo activo,
    // debe usar el flujo de baja con desinstalación.
    const { count: eqCount } = await admin
      .from("customer_equipment")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", input.customer_id)
      .eq("is_active", true);
    if ((eqCount ?? 0) > 0) {
      return {
        ok: false,
        error:
          "Este cliente tiene equipos instalados. Bórralo decidiendo qué hacer con cada equipo.",
      };
    }

    // Auditoría antes del DELETE (después no podríamos referenciar el id).
    try {
      await admin.from("events").insert({
        company_id: session.company_id,
        subject_type: "customer",
        subject_id: input.customer_id,
        kind: "customer.deleted_empty",
        payload: { reason: "Creado por error (sin equipos)" },
        actor_user_id: session.user_id,
      });
    } catch {
      /* no-op */
    }

    const del = await admin
      .from("customers")
      .delete()
      .eq("id", input.customer_id)
      .eq("company_id", session.company_id);
    if (del.error) {
      return {
        ok: false,
        error:
          "No se pudo borrar directamente: puede tener propuestas, contratos o facturas asociados. Anonimízalo desde el panel RGPD de su ficha.",
      };
    }

    revalidatePath("/clientes");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Inserta (o actualiza si ya existe) la fila de venta perdida de un cliente
 * dado de baja. Defensivo: si la migración del enum/columna aún no estuviera
 * aplicada, registra el fallo sin romper la baja del cliente.
 */
async function upsertCustomerLostSale(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  p: {
    company_id: string;
    customer_id: string;
    created_by: string;
    churnType: "removed" | "sold_no_relation";
    reason: string | null;
  },
): Promise<void> {
  const reasonBase =
    p.churnType === "removed"
      ? "Cliente dado de baja — equipo retirado"
      : "Cliente con equipo nuestro instalado — rechaza mantenimientos";
  const reason = p.reason ? `${reasonBase}. ${p.reason}` : reasonBase;
  const reasonCategory =
    p.churnType === "removed" ? "retirada" : "rechaza_mantenimiento";
  try {
    const { data: existing } = await admin
      .from("lost_sales")
      .select("id")
      .eq("company_id", p.company_id)
      .eq("origin", "customer_churned")
      .eq("customer_id", p.customer_id)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      await admin
        .from("lost_sales")
        .update({
          reason,
          reason_category: reasonCategory,
          is_recovered: false,
        })
        .eq("id", existing.id);
      return;
    }
    await admin.from("lost_sales").insert({
      company_id: p.company_id,
      origin: "customer_churned",
      customer_id: p.customer_id,
      reason,
      reason_category: reasonCategory,
      is_recovered: false,
      created_by: p.created_by,
    });
  } catch (e) {
    console.error(
      "[churn] lost_sale upsert:",
      e instanceof Error ? e.message : e,
    );
  }
}
