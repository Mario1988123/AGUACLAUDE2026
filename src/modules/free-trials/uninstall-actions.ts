"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface ScheduleFreeTrialUninstallInput {
  trial_id: string;
  /** Almacén destino donde irá el equipo retirado (se sugiere uno con `is_used_equipment_default=true`). */
  destination_warehouse_id: string;
  /** Fecha programada — si null, queda como "unscheduled" para que el director técnico la coloque. */
  scheduled_at?: string | null;
  /** Instalador asignado (opcional, puede asignarse luego desde la agenda). */
  installer_user_id?: string | null;
  /** Estado de retorno del equipo. Default: used. El técnico puede ajustar al cerrar. */
  default_state?: "used" | "damaged" | "refurbished";
  notes?: string | null;
}

/**
 * Genera una orden de DESINSTALACIÓN para una prueba gratuita.
 *
 * Crea una `installations` con kind='uninstall' enlazada al trial (vía
 * `free_trial_id`), copia los items para que el técnico sepa qué equipo
 * retirar y deja constancia en las notas del almacén destino + estado de
 * retorno. La prueba NO cambia de estado todavía — sigue en `installed`
 * hasta que el técnico complete la desinstalación. En ese momento, el
 * cierre de la instalación (completeInstallation kind='uninstall' con
 * free_trial_id) marcará automáticamente la prueba como `removed`.
 *
 * Decisión usuario 2026-05-12: NO se puede marcar una prueba como
 * devuelta directamente. Hay que pasar por una desinstalación agendada.
 */
export async function scheduleFreeTrialUninstallAction(
  input: ScheduleFreeTrialUninstallInput,
): Promise<
  | { ok: true; installation_id: string; reference_code: string }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // 1) Cargar prueba
    const { data: trialData, error: tErr } = await admin
      .from("free_trials")
      .select(
        "id, company_id, status, customer_id, installation_address_id, assigned_installer_user_id",
      )
      .eq("id", input.trial_id)
      .maybeSingle();
    if (tErr) return { ok: false, error: tErr.message };
    const trial = trialData as
      | {
          id: string;
          company_id: string;
          status: string;
          customer_id: string | null;
          installation_address_id: string | null;
          assigned_installer_user_id: string | null;
        }
      | null;
    if (!trial) return { ok: false, error: "Prueba no encontrada" };
    if (trial.company_id !== session.company_id) {
      return { ok: false, error: "Prueba de otra empresa" };
    }
    if (!["installed", "scheduled", "expired", "rejected"].includes(trial.status)) {
      return {
        ok: false,
        error: `No se puede agendar desinstalación de una prueba en estado "${trial.status}"`,
      };
    }

    // 2) Comprobar que no haya ya una orden de uninstall abierta para
    // esta prueba (idempotencia).
    const { data: existing } = await admin
      .from("installations")
      .select("id, status, reference_code")
      .eq("free_trial_id", input.trial_id)
      .eq("kind", "uninstall")
      .is("deleted_at", null)
      .in("status", ["scheduled", "agendada", "unscheduled", "in_progress", "paused"])
      .limit(1)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        installation_id: (existing as { id: string }).id,
        reference_code:
          (existing as { reference_code: string | null }).reference_code ??
          "(existente)",
      };
    }

    // 3) Verificar que el almacén destino existe y es de la empresa
    const { data: wh } = await admin
      .from("warehouses")
      .select("id, company_id")
      .eq("id", input.destination_warehouse_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!wh) return { ok: false, error: "Almacén destino no encontrado" };
    if ((wh as { company_id: string }).company_id !== session.company_id) {
      return { ok: false, error: "Almacén de otra empresa" };
    }

    // 4) Reference code I-YYYY-NNNN
    const year = new Date().getFullYear();
    const yearPrefix = `I-${year}-`;
    const { data: lastCoded } = await admin
      .from("installations")
      .select("reference_code")
      .eq("company_id", session.company_id)
      .like("reference_code", `${yearPrefix}%`)
      .order("reference_code", { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextNum = 1;
    const lastCode = (lastCoded as { reference_code: string | null } | null)
      ?.reference_code;
    if (lastCode) {
      const m = lastCode.match(/-(\d+)$/);
      if (m) nextNum = parseInt(m[1]!, 10) + 1;
    }
    const referenceCode = `${yearPrefix}${String(nextNum).padStart(4, "0")}`;

    // 5) Items que vamos a retirar (snapshot de free_trial_items)
    const { data: tItems } = await admin
      .from("free_trial_items")
      .select("product_id, product_name_snapshot, quantity, serial_number")
      .eq("free_trial_id", input.trial_id);
    const items = (tItems ?? []) as Array<{
      product_id: string;
      product_name_snapshot: string;
      quantity: number;
      serial_number: string | null;
    }>;

    // 6) Notas con destino + estado + breakdown legible
    const defaultState = input.default_state ?? "used";
    const itemLines = items.map(
      (it) =>
        `  - ${it.product_name_snapshot}${
          it.serial_number ? ` (S/N ${it.serial_number})` : ""
        } x${it.quantity}`,
    );
    const notesParts = [
      `Desinstalación de prueba gratuita (${items.length} item${items.length === 1 ? "" : "es"}):`,
      ...itemLines,
      `destination_warehouse_id=${input.destination_warehouse_id}`,
      `default_state=${defaultState}`,
      `free_trial_id=${input.trial_id}`,
      input.notes ?? "",
    ].filter(Boolean);

    // 7) Crear installation
    const status = input.scheduled_at ? "scheduled" : "unscheduled";
    const installerId =
      input.installer_user_id ?? trial.assigned_installer_user_id ?? null;
    const { data: inst, error: instErr } = await admin
      .from("installations")
      .insert({
        company_id: session.company_id,
        kind: "uninstall",
        status,
        reference_code: referenceCode,
        customer_id: trial.customer_id,
        free_trial_id: input.trial_id,
        address_id: trial.installation_address_id,
        installer_user_id: installerId,
        scheduled_at: input.scheduled_at ?? null,
        notes: notesParts.join("\n"),
      })
      .select("id, reference_code")
      .single();
    if (instErr) return { ok: false, error: instErr.message };
    const i = inst as { id: string; reference_code: string | null };

    // 8) installation_items: copia de los free_trial_items
    if (items.length > 0) {
      const rows = items.map((it) => ({
        installation_id: i.id,
        company_id: session.company_id,
        product_id: it.product_id,
        quantity: it.quantity,
        serial_number: it.serial_number,
        notes: "Retirar de prueba gratuita",
      }));
      const { error: itErr } = await admin
        .from("installation_items")
        .insert(rows);
      if (itErr) {
        console.error("[scheduleFreeTrialUninstall] items insert:", itErr.message);
      }
    }

    // 9) Evento en la prueba (timeline visible en /pruebas-gratuitas/[id])
    await admin.from("events").insert({
      company_id: session.company_id,
      subject_type: "free_trial",
      subject_id: input.trial_id,
      kind: "free_trial.uninstall_scheduled",
      payload: {
        installation_id: i.id,
        scheduled_at: input.scheduled_at ?? null,
        destination_warehouse_id: input.destination_warehouse_id,
      },
      actor_user_id: session.user_id,
    });

    revalidatePath(`/pruebas-gratuitas/${input.trial_id}`);
    revalidatePath("/pruebas-gratuitas");
    revalidatePath("/instalaciones");

    return {
      ok: true,
      installation_id: i.id,
      reference_code: i.reference_code ?? referenceCode,
    };
  } catch (e) {
    console.error("[scheduleFreeTrialUninstall] FAILED:", e);
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}

/**
 * Hook llamado desde `completeInstallation` cuando se cierra una
 * installation kind='uninstall' que TIENE `free_trial_id`. Marca la
 * prueba como `removed`, registra el evento y devuelve el stock al
 * almacén destino indicado en las notas de la installation.
 *
 * El flujo de stock lo hace `processUninstallCompletion` (genérico para
 * cualquier desinstalación). Aquí solo cambiamos el estado de la prueba.
 */
export async function processFreeTrialUninstallCompletion(
  installationId: string,
): Promise<void> {
  // SEGURIDAD: aunque normalmente lo llama completeInstallation (ya verificado),
  // es una server action exportada → exigimos sesión y filtramos por company_id.
  const session = await requireSession();
  if (!session.company_id) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: inst } = await admin
    .from("installations")
    .select("id, company_id, free_trial_id, kind")
    .eq("id", installationId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  const i = inst as
    | {
        id: string;
        company_id: string;
        free_trial_id: string | null;
        kind: string;
      }
    | null;
  if (!i || i.kind !== "uninstall" || !i.free_trial_id) return;

  const now = new Date().toISOString();
  const upd = await admin
    .from("free_trials")
    .update({ status: "removed", removed_at: now })
    .eq("id", i.free_trial_id)
    .eq("company_id", session.company_id);
  if (upd.error) {
    console.error(
      "[processFreeTrialUninstallCompletion] update free_trials:",
      upd.error.message,
    );
    return;
  }

  await admin.from("events").insert({
    company_id: i.company_id,
    subject_type: "free_trial",
    subject_id: i.free_trial_id,
    kind: "free_trial.returned",
    payload: { installation_id: i.id, auto: true },
  });
}
