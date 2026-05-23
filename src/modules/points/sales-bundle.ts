"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { awardPoints, getPointsSettings } from "./award";

/**
 * Otorga el bundle completo de puntos por una venta al cerrar el ciclo
 * (cuando se completa la instalación). Llamar UNA SOLA VEZ por contrato
 * (idempotente: si ya hay asientos sale/sale_with_discount/sale_tmk_split
 * para el contrato, no duplica).
 *
 * Cálculo:
 *  - basePoints = points_per_equipment_sold × Σ contract_items.quantity
 *  - Si la propuesta origen tiene algún item con descuento bajo el
 *    mín_authorized → aplicar discount_penalty_percent al base.
 *  - Si hay TMK origen (lead.origin_tmk_user_id):
 *      tmkPoints = base × tmk_split_percent / 100
 *      commercialPoints = base − tmkPoints
 *    Si no hay TMK: comercial recibe todo el base.
 *
 * NO incluye los puntos del instalador (esos se gestionan en su acción).
 */
export async function awardSalesBundleOnInstall(
  installationId: string,
): Promise<{ awarded: boolean; reason?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // Cargar la installation y su contract
  const { data: inst } = await admin
    .from("installations")
    .select("id, company_id, contract_id, kind")
    .eq("id", installationId)
    .maybeSingle();
  const i = inst as
    | {
        id: string;
        company_id: string;
        contract_id: string | null;
        kind: string;
      }
    | null;
  if (!i || !i.contract_id) {
    return { awarded: false, reason: "sin_contrato" };
  }
  // Solo damos puntos por instalaciones 'normal' (las free_trial no, las
  // relocation/uninstall tampoco — esas son operativas, no ventas)
  if (i.kind !== "normal") {
    return { awarded: false, reason: `kind_${i.kind}_no_aplica` };
  }

  // Idempotencia: si ya hay puntos otorgados para este contrato con
  // razones de venta, no repetimos.
  const { count: priorCount } = await admin
    .from("points_ledger")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", i.contract_id)
    .in("reason", [
      "sale",
      "sale_with_discount",
      "sale_tmk_split",
    ]);
  if ((priorCount ?? 0) > 0) {
    return { awarded: false, reason: "ya_otorgados" };
  }

  // Cargar contrato + comercial asignado (fallback a created_by). Hasta
  // 2026-05-22 contracts.assigned_user_id solo se rellenaba al reasignar,
  // así que la mayoría de contratos antiguos lo tenían NULL y este path
  // retornaba "sin_comercial_asignado" → el comercial nunca cobraba.
  const { data: contract } = await admin
    .from("contracts")
    .select("id, assigned_user_id, created_by, customer_id")
    .eq("id", i.contract_id)
    .maybeSingle();
  const c = contract as
    | {
        id: string;
        assigned_user_id: string | null;
        created_by: string | null;
        customer_id: string | null;
      }
    | null;
  const salesUserId = c?.assigned_user_id ?? c?.created_by ?? null;
  if (!c || !salesUserId) {
    return { awarded: false, reason: "sin_comercial_asignado" };
  }

  // Resolver TMK origen: customer.source_lead_id → lead.origin_tmk_user_id
  let tmkUserId: string | null = null;
  if (c.customer_id) {
    const { data: cust } = await admin
      .from("customers")
      .select("source_lead_id")
      .eq("id", c.customer_id)
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

  // Contar items + cantidad total
  const { data: items } = await admin
    .from("contract_items")
    .select("product_id, quantity, unit_price_cents")
    .eq("contract_id", c.id);
  type CI = {
    product_id: string;
    quantity: number;
    unit_price_cents: number | null;
  };
  const itemList = ((items ?? []) as CI[]);
  const totalEquipments = itemList.reduce((s, it) => s + it.quantity, 0) || 1;

  // Detectar descuento: si algún unit_price_cents < min_authorized del
  // pricing plan cash del producto
  const productIds = itemList.map((it) => it.product_id);
  let hasDiscount = false;
  if (productIds.length > 0) {
    const { data: plans } = await admin
      .from("product_pricing_plans")
      .select("product_id, min_authorized_cents")
      .in("product_id", productIds)
      .eq("plan_type", "cash");
    const minMap = new Map(
      ((plans ?? []) as Array<{
        product_id: string;
        min_authorized_cents: number | null;
      }>).map((p) => [p.product_id, p.min_authorized_cents]),
    );
    for (const it of itemList) {
      const min = minMap.get(it.product_id);
      if (
        min != null &&
        it.unit_price_cents != null &&
        it.unit_price_cents < min
      ) {
        hasDiscount = true;
        break;
      }
    }
  }

  const cfg = await getPointsSettings(i.company_id);
  const base = totalEquipments * cfg.points_per_equipment_sold;
  const adjusted = hasDiscount
    ? Math.round((base * (100 - cfg.discount_penalty_percent)) / 100)
    : base;

  const tmkPct = tmkUserId && tmkUserId !== salesUserId ? cfg.tmk_split_percent : 0;
  const tmkPoints = Math.round((adjusted * tmkPct) / 100);
  const commercialPoints = adjusted - tmkPoints;

  if (commercialPoints > 0) {
    await awardPoints({
      company_id: i.company_id,
      user_id: salesUserId,
      points: commercialPoints,
      reason: hasDiscount ? "sale_with_discount" : "sale",
      subject_type: "contract",
      subject_id: c.id,
      contract_id: c.id,
      installation_id: installationId,
      metadata: {
        equipments: totalEquipments,
        has_discount: hasDiscount,
        tmk_split_pct: tmkPct,
      },
    });
  }
  if (tmkPoints > 0 && tmkUserId) {
    await awardPoints({
      company_id: i.company_id,
      user_id: tmkUserId,
      points: tmkPoints,
      reason: "sale_tmk_split",
      subject_type: "contract",
      subject_id: c.id,
      contract_id: c.id,
      installation_id: installationId,
      metadata: { split_pct: tmkPct, has_discount: hasDiscount },
    });
  }

  return { awarded: true };
}

/**
 * Recorre todas las instalaciones COMPLETADAS de la empresa cuyo contrato
 * no tenga aún puntos de venta otorgados (sale / sale_with_discount /
 * sale_tmk_split) y reintenta `awardSalesBundleOnInstall`. Idempotente —
 * el propio bundle hace el check antes de insertar.
 *
 * Solo admin (validación al final del handler en config-actions).
 *
 * Devuelve { processed, awarded, skipped } como resumen.
 */
export async function recomputeMissingSalesPoints(
  companyId: string,
): Promise<{
  processed: number;
  awarded: number;
  skipped: number;
  errors: string[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1) Listar instalaciones completadas de la empresa con kind=normal.
  const { data: installs } = await admin
    .from("installations")
    .select("id, contract_id, completed_at")
    .eq("company_id", companyId)
    .eq("kind", "normal")
    .not("completed_at", "is", null)
    .not("contract_id", "is", null);

  type IR = {
    id: string;
    contract_id: string | null;
    completed_at: string | null;
  };
  const rows = (installs ?? []) as IR[];
  if (rows.length === 0) {
    return { processed: 0, awarded: 0, skipped: 0, errors: [] };
  }

  // 2) Para cada una llamar al bundle (idempotente: salta si ya tiene
  //    asientos sale*, también si el contrato sigue sin comercial).
  let awarded = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const r of rows) {
    try {
      const res = await awardSalesBundleOnInstall(r.id);
      if (res.awarded) awarded += 1;
      else skipped += 1;
    } catch (e) {
      errors.push(
        `installation ${r.id}: ${e instanceof Error ? e.message : "error"}`,
      );
    }
  }
  return { processed: rows.length, awarded, skipped, errors };
}
