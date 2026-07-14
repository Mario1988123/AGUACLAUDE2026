"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { isModuleActiveForCompany } from "@/shared/lib/auth/module-guard";
import { notifyContractSigned } from "@/modules/notifications/notifier";

/**
 * Efectos secundarios que deben ocurrir cuando un contrato pasa a firmado,
 * INDEPENDIENTEMENTE de cómo se firmó (presencial en iPad o remoto por enlace):
 *  · soft-delete del lead origen
 *  · materializar los pagos previstos en Wallet
 *  · agendar mantenimientos (si el módulo está activo)
 *  · auto-crear la instalación pendiente con sus items (si el módulo está activo)
 *  · reservar stock
 *  · crear sales_records para dashboard/objetivos
 *  · evento contract.signed + notificación a admin/directores
 *  · (opcional) email de bienvenida con el PDF
 *
 * Diseñado para ser llamado SIN sesión (firma remota): usa el cliente admin
 * y recibe companyId + actorUserId explícitos. Todo fail-soft: ningún paso
 * rompe la firma, que ya está registrada antes de llamar a esto.
 *
 * NOTA: la firma presencial (markContractSigned en actions.ts) tiene hoy su
 * propia copia inline de esta lógica. Este helper da PARIDAD a la firma
 * remota. Si en el futuro se unifican, este es el sitio canónico.
 */
export async function runPostSignSideEffects(opts: {
  contractId: string;
  companyId: string;
  actorUserId: string | null;
  sendWelcomeEmail?: boolean;
}): Promise<void> {
  const { contractId, companyId, actorUserId } = opts;
  const sendWelcomeEmail = opts.sendWelcomeEmail ?? false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // --- Cliente del contrato + soft-delete del lead origen -------------------
  let contractCustomerId: string | null = null;
  try {
    const { data: contractRow } = await admin
      .from("contracts")
      .select("customer_id")
      .eq("id", contractId)
      .maybeSingle();
    contractCustomerId =
      (contractRow as { customer_id: string | null } | null)?.customer_id ?? null;
    if (contractCustomerId) {
      const { data: cust } = await admin
        .from("customers")
        .select("source_lead_id")
        .eq("id", contractCustomerId)
        .maybeSingle();
      const sourceLeadId = (cust as { source_lead_id: string | null } | null)
        ?.source_lead_id;
      if (sourceLeadId) {
        await admin
          .from("leads")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", sourceLeadId);
      }
    }
  } catch {
    /* fail-soft */
  }

  // --- Materializar pagos previstos en Wallet -------------------------------
  let walletCreated = 0;
  try {
    const { data: payments } = await admin
      .from("contract_payments")
      .select("id, concept, amount_cents, method, wallet_entry_id, contract_id")
      .eq("contract_id", contractId)
      .eq("status", "pending")
      .is("wallet_entry_id", null);
    const list = (payments ?? []) as Array<{
      id: string;
      concept: string;
      amount_cents: number;
      method: string;
      wallet_entry_id: string | null;
      contract_id: string;
    }>;
    const { findLiveWalletEntryForPayment } = await import(
      "@/modules/wallet/entry-for-payment"
    );
    for (const p of list) {
      // Idempotencia (auditoría doble cobro): si una ejecución anterior insertó
      // la entry pero falló al enlazarla, reutilizamos esa entry y reparamos el
      // enlace en vez de duplicar el cobro.
      let entryId = await findLiveWalletEntryForPayment(admin, companyId, p.id);
      if (!entryId) {
        const { data: created, error: insErr } = await admin
          .from("wallet_entries")
          .insert({
            company_id: companyId,
            contract_id: p.contract_id,
            contract_payment_id: p.id,
            customer_id: contractCustomerId,
            concept: p.concept,
            amount_cents: p.amount_cents,
            method: p.method,
            status: "pending",
          })
          .select("id")
          .single();
        if (insErr || !created) {
          console.error("[post-sign] wallet insert:", insErr?.message);
          continue;
        }
        entryId = (created as { id: string }).id;
        walletCreated++;
      }
      const { error: linkErr } = await admin
        .from("contract_payments")
        .update({ wallet_entry_id: entryId })
        .eq("id", p.id);
      if (linkErr) {
        console.error("[post-sign] wallet link:", linkErr.message);
      }
    }
  } catch (e) {
    console.error("[post-sign] wallet entries:", e);
  }

  // --- Agendar mantenimientos (si módulo activo) ----------------------------
  let scheduledCount = 0;
  try {
    if (await isModuleActiveForCompany(companyId, "maintenance")) {
      const { scheduleMaintenanceForContract } = await import(
        "./maintenance-scheduler"
      );
      scheduledCount = await scheduleMaintenanceForContract(contractId);
    }
  } catch {
    /* fail-soft */
  }

  // --- Auto-crear instalación pendiente con items (si módulo activo) --------
  let installationCreated = false;
  try {
    const instModuleOn = await isModuleActiveForCompany(companyId, "installations");
    const { count: instCount } = await admin
      .from("installations")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", contractId)
      .is("deleted_at", null);
    if (instModuleOn && (instCount ?? 0) === 0) {
      const year = new Date().getFullYear();
      const yearPrefix = `I-${year}-`;
      const { data: lastCoded } = await admin
        .from("installations")
        .select("reference_code")
        .eq("company_id", companyId)
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

      const { data: instCreated } = await admin
        .from("installations")
        .insert({
          company_id: companyId,
          kind: "normal",
          status: "unscheduled",
          scheduled_at: null,
          contract_id: contractId,
          customer_id: contractCustomerId,
          reference_code: referenceCode,
          created_by: actorUserId,
        })
        .select("id")
        .single();
      const newInstId = (instCreated as { id: string } | null)?.id;
      if (newInstId) {
        const { data: items, error: itemsErr } = await admin
          .from("contract_items")
          .select("product_id, quantity, display_order, notes")
          .eq("contract_id", contractId);
        const itemList = (items ?? []) as Array<{
          product_id: string;
          quantity: number;
          display_order: number;
          notes: string | null;
        }>;
        if (itemList.length > 0) {
          const insIt = await admin.from("installation_items").insert(
            itemList.map((it) => ({
              installation_id: newInstId,
              company_id: companyId,
              product_id: it.product_id,
              quantity: it.quantity,
              display_order: it.display_order,
              notes: it.notes,
            })),
          );
          if (insIt.error) {
            console.error("[post-sign] installation_items insert:", insIt.error);
          }
        } else {
          try {
            await admin.from("events").insert({
              company_id: companyId,
              subject_type: "installation",
              subject_id: newInstId,
              kind: "installation.items_missing",
              payload: {
                reason: itemsErr ? "select failed" : "contract had no items",
                error: itemsErr?.message ?? null,
              },
              actor_user_id: actorUserId,
            });
          } catch {
            /* fail-soft */
          }
        }
        installationCreated = true;
      }
    }
  } catch {
    /* fail-soft */
  }

  // --- Reservar stock -------------------------------------------------------
  try {
    const { reserveStockForContractAction } = await import(
      "@/modules/warehouses/reservation-actions"
    );
    const r = await reserveStockForContractAction(contractId);
    if (!r.ok && r.error) {
      console.warn("[post-sign] reservas no creadas:", r.error);
    }
  } catch (e) {
    console.error("[post-sign] reserveStock:", e);
  }

  // --- Sales records (dashboard/objetivos). Puntos se otorgan al instalar. --
  try {
    // Idempotencia: si ya hay sales_records para este contrato, no duplicar.
    const { count: srCount } = await admin
      .from("sales_records")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", contractId);
    if ((srCount ?? 0) === 0) {
      const BASE_COLS =
        "id, customer_id, plan_type, total_cash_cents, monthly_cents, duration_months";
      let { data: contractFull, error: cfErr } = await admin
        .from("contracts")
        .select(`${BASE_COLS}, assigned_user_id, financier_payment_cents`)
        .eq("id", contractId)
        .single();
      if (cfErr && /column .* does not exist/i.test(cfErr.message ?? "")) {
        const retry = await admin
          .from("contracts")
          .select(BASE_COLS)
          .eq("id", contractId)
          .single();
        contractFull = retry.data;
        cfErr = retry.error;
      }
      if (cfErr) throw new Error(cfErr.message);
      const cf = contractFull as {
        id: string;
        customer_id: string | null;
        plan_type: "cash" | "rental" | "renting";
        total_cash_cents: number | null;
        monthly_cents: number | null;
        duration_months: number | null;
        assigned_user_id?: string | null;
        financier_payment_cents?: number | null;
      };

      let tmkUserId: string | null = null;
      if (cf.customer_id) {
        const { data: cust } = await admin
          .from("customers")
          .select("source_lead_id")
          .eq("id", cf.customer_id)
          .maybeSingle();
        const sourceLeadId = (cust as { source_lead_id: string | null } | null)
          ?.source_lead_id;
        if (sourceLeadId) {
          const { data: l } = await admin
            .from("leads")
            .select("origin_tmk_user_id")
            .eq("id", sourceLeadId)
            .maybeSingle();
          tmkUserId =
            (l as { origin_tmk_user_id: string | null } | null)
              ?.origin_tmk_user_id ?? null;
        }
      }

      let totalCents = 0;
      if (cf.plan_type === "cash") {
        totalCents = cf.total_cash_cents ?? 0;
      } else if (cf.plan_type === "renting") {
        totalCents =
          cf.financier_payment_cents ??
          (cf.monthly_cents ?? 0) * (cf.duration_months ?? 0);
      } else {
        totalCents = cf.monthly_cents ?? 0;
      }

      const { data: contractItems } = await admin
        .from("contract_items")
        .select("id, product_id, quantity")
        .eq("contract_id", contractId);
      const items = (contractItems ?? []) as Array<{
        id: string;
        product_id: string;
        quantity: number;
      }>;

      const periodYear = new Date().getFullYear();
      const periodMonth = new Date().getMonth() + 1;
      const recordRows = (items.length > 0 ? items : [null]).map((it) => ({
        company_id: companyId,
        contract_id: contractId,
        contract_item_id: it?.id ?? null,
        sales_user_id: cf.assigned_user_id ?? null,
        tmk_user_id: tmkUserId,
        installer_user_id: null,
        plan_type: cf.plan_type,
        total_cents:
          items.length > 0 ? Math.round(totalCents / items.length) : totalCents,
        monthly_cents: cf.monthly_cents,
        duration_months: cf.duration_months,
        period_year: periodYear,
        period_month: periodMonth,
      }));
      const { error: srErr } = await admin.from("sales_records").insert(recordRows);
      if (srErr) {
        console.error("[post-sign] sales_records insert:", srErr.message);
        try {
          const { reconcileSalesRecordsForCompany } = await import(
            "@/modules/sales/reconcile"
          );
          await reconcileSalesRecordsForCompany(admin, companyId, { force: false });
        } catch (e) {
          console.error("[post-sign] reconcile fallback:", e);
        }
      }
    }
  } catch (e) {
    console.error("[post-sign] sales_records:", e);
  }

  // --- Evento + notificación ------------------------------------------------
  try {
    await admin.from("events").insert({
      company_id: companyId,
      subject_type: "contract",
      subject_id: contractId,
      kind: "contract.signed",
      payload: {
        wallet_entries_created: walletCreated,
        maintenance_jobs_scheduled: scheduledCount,
        installation_auto_created: installationCreated,
        via: actorUserId ? "presencial" : "remote",
      },
      actor_user_id: actorUserId,
    });
  } catch {
    /* fail-soft */
  }

  try {
    const { data: cref } = await admin
      .from("contracts")
      .select("reference_code")
      .eq("id", contractId)
      .single();
    await notifyContractSigned(
      companyId,
      contractId,
      (cref as { reference_code: string | null } | null)?.reference_code ?? null,
    );
  } catch {
    /* fail-soft */
  }

  // --- Email de bienvenida (opcional; en remoto ya se envía la copia firmada)
  if (sendWelcomeEmail) {
    try {
      const { sendContractByEmailAction } = await import(
        "@/modules/mailing/send-document-actions"
      );
      await sendContractByEmailAction(contractId);
    } catch (e) {
      console.error("[post-sign] welcome email:", e);
    }
  }

  revalidatePath(`/contratos/${contractId}`);
  revalidatePath("/contratos");
  revalidatePath("/wallet");
  revalidatePath("/instalaciones");
}
