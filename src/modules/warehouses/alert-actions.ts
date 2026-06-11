"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";

export interface StockAlert {
  id: string;
  product_id: string;
  product_name: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  kind:
    | "predictive_low"
    | "below_min"
    | "over_max"
    | "no_rotation_90d"
    | "no_lead_time_set";
  severity: "info" | "warning" | "critical";
  message: string;
  payload: Record<string, unknown> | null;
  status: "active" | "dismissed" | "auto_resolved";
  created_at: string;
}

const KIND_SEVERITY: Record<StockAlert["kind"], StockAlert["severity"]> = {
  below_min: "critical",
  predictive_low: "warning",
  over_max: "info",
  no_rotation_90d: "info",
  no_lead_time_set: "info",
};

/**
 * Recalcula todas las alertas de stock para la empresa.
 *  - Recorre los productos con stock_managed = true.
 *  - Para cada producto: stock total, ritmo medio diario (últimos 90d),
 *    factor estacional (mismo mes año pasado vs año pasado completo).
 *  - Genera alerta predictive_low si days_to_min < lead_time.
 *  - Marca below_min/over_max si corresponde.
 *  - Marca no_rotation_90d si stock>0 y 0 salidas en 90d.
 *  - Marca no_lead_time_set si gestionado pero sin lead_time.
 *
 * Las alertas activas se reemplazan por las nuevas (delete+insert dentro de
 * la misma empresa). Las descartadas (status='dismissed') no se reactivan
 * automáticamente, pero el conteo se actualiza al recalcular.
 */
export async function recomputeStockAlertsAction(): Promise<{
  ok: boolean;
  total: number;
  error?: string;
}> {
  try {
    const session = await requireSession();
    if (!session.company_id) return { ok: false, total: 0, error: "Sin empresa" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    // 0) Si la EMPRESA tiene menos de N días de vida, no generamos
    // alertas de rotación (sería absurdo: "sin movimiento 90d" cuando
    // la empresa lleva 30 días). Leemos también warehouse_settings.
    const { data: company } = await admin
      .from("companies")
      .select("created_at")
      .eq("id", session.company_id)
      .maybeSingle();
    const companyAgeDays =
      (company as { created_at?: string } | null)?.created_at
        ? Math.floor(
            (Date.now() -
              new Date((company as { created_at: string }).created_at).getTime()) /
              86400000,
          )
        : 0;
    let alertNoRotationDays = 90;
    let alertMinCompanyAgeDays = 90;
    let alertsEnabled = {
      below_min: true,
      predictive_low: true,
      over_max: true,
      no_rotation_90d: true,
      no_lead_time_set: true,
    };
    try {
      const { data: ws } = await admin
        .from("warehouse_settings")
        .select(
          "alert_no_rotation_days, alert_min_company_age_days, alerts_enabled",
        )
        .eq("company_id", session.company_id)
        .maybeSingle();
      const s = ws as {
        alert_no_rotation_days?: number | null;
        alert_min_company_age_days?: number | null;
        alerts_enabled?: typeof alertsEnabled | null;
      } | null;
      if (s?.alert_no_rotation_days)
        alertNoRotationDays = s.alert_no_rotation_days;
      if (s?.alert_min_company_age_days)
        alertMinCompanyAgeDays = s.alert_min_company_age_days;
      if (s?.alerts_enabled) alertsEnabled = { ...alertsEnabled, ...s.alerts_enabled };
    } catch {
      /* tabla no aplicada todavía: defaults */
    }
    const companyTooYoungForRotationAlerts =
      companyAgeDays < alertMinCompanyAgeDays;

    // 1) Productos gestionados con stock
    const { data: prodsRaw, error: prodErr } = await admin
      .from("products")
      .select(
        "id, name, stock_managed, stock_min, stock_max, lead_time_days",
      )
      .eq("company_id", session.company_id)
      .is("deleted_at", null)
      .eq("stock_managed", true);
    if (prodErr) return { ok: false, total: 0, error: prodErr.message };
    type P = {
      id: string;
      name: string;
      stock_managed: boolean;
      stock_min: number;
      stock_max: number | null;
      lead_time_days: number | null;
    };
    const products = (prodsRaw ?? []) as P[];
    if (products.length === 0) {
      // Borrar alertas activas existentes (todas resueltas)
      await admin
        .from("stock_alerts")
        .delete()
        .eq("company_id", session.company_id)
        .eq("status", "active");
      return { ok: true, total: 0 };
    }
    const productIds = products.map((p) => p.id);

    // 2) Stock total por producto
    const { data: stocksRaw } = await admin
      .from("warehouse_stock")
      .select("product_id, quantity")
      .in("product_id", productIds);
    const totalByProduct = new Map<string, number>();
    for (const s of (stocksRaw ?? []) as Array<{ product_id: string; quantity: number }>) {
      totalByProduct.set(s.product_id, (totalByProduct.get(s.product_id) ?? 0) + s.quantity);
    }

    // 3) Salidas últimos 90d por producto + último movimiento
    const since90 = new Date();
    since90.setDate(since90.getDate() - 90);
    const { data: outs90 } = await admin
      .from("stock_movements")
      .select("product_id, quantity, performed_at")
      .in("product_id", productIds)
      .in("movement_type", ["outbound_install", "outbound_trial", "outbound_maintenance"])
      .gte("performed_at", since90.toISOString());
    type M = { product_id: string; quantity: number; performed_at: string };
    const outsByProduct = new Map<string, M[]>();
    for (const m of (outs90 ?? []) as M[]) {
      if (!outsByProduct.has(m.product_id)) outsByProduct.set(m.product_id, []);
      outsByProduct.get(m.product_id)!.push(m);
    }

    // Primer movimiento (cualquier tipo) por producto, para no marcar
    // "sin rotación 90d" en stock recién creado: si la primera entrada
    // tiene < 90 días, el producto aún no ha tenido tiempo de moverse.
    const { data: firstMovs } = await admin
      .from("stock_movements")
      .select("product_id, performed_at")
      .in("product_id", productIds)
      .order("performed_at", { ascending: true });
    const firstMovementByProduct = new Map<string, string>();
    for (const m of (firstMovs ?? []) as Array<{
      product_id: string;
      performed_at: string;
    }>) {
      if (!firstMovementByProduct.has(m.product_id)) {
        firstMovementByProduct.set(m.product_id, m.performed_at);
      }
    }

    // 4) Estacionalidad: mismo mes año pasado vs año pasado completo
    const now = new Date();
    const ly1 = new Date(now);
    ly1.setFullYear(ly1.getFullYear() - 1);
    ly1.setDate(1);
    ly1.setHours(0, 0, 0, 0);
    const ly1End = new Date(ly1);
    ly1End.setMonth(ly1End.getMonth() + 1);
    const lyStart = new Date(ly1);
    lyStart.setFullYear(lyStart.getFullYear()); // ya year pasado
    // Año pasado completo: desde ese 1er día menos 11 meses hasta ly1End
    const lyFullStart = new Date(ly1);
    lyFullStart.setMonth(lyFullStart.getMonth() - 11);
    const { data: outsHistory } = await admin
      .from("stock_movements")
      .select("product_id, quantity, performed_at")
      .in("product_id", productIds)
      .in("movement_type", ["outbound_install", "outbound_trial", "outbound_maintenance"])
      .gte("performed_at", lyFullStart.toISOString())
      .lt("performed_at", ly1End.toISOString());
    const sameMonthLY = new Map<string, number>();
    const fullYearLY = new Map<string, number>();
    for (const m of (outsHistory ?? []) as M[]) {
      const dt = new Date(m.performed_at);
      fullYearLY.set(m.product_id, (fullYearLY.get(m.product_id) ?? 0) + m.quantity);
      if (dt >= ly1 && dt < ly1End) {
        sameMonthLY.set(m.product_id, (sameMonthLY.get(m.product_id) ?? 0) + m.quantity);
      }
    }

    // 5) Borrar alertas activas previas
    await admin
      .from("stock_alerts")
      .delete()
      .eq("company_id", session.company_id)
      .eq("status", "active");

    // 6) Calcular alertas nuevas
    type Insert = {
      company_id: string;
      product_id: string;
      warehouse_id: string | null;
      kind: StockAlert["kind"];
      severity: StockAlert["severity"];
      message: string;
      payload: Record<string, unknown>;
    };
    const newAlerts: Insert[] = [];

    for (const p of products) {
      const total = totalByProduct.get(p.id) ?? 0;
      const outs = outsByProduct.get(p.id) ?? [];
      const totalOut = outs.reduce((s, m) => s + m.quantity, 0);
      const dailyRate = totalOut / 90;

      // Estacionalidad: factor = (sameMonthLY * 12) / fullYearLY
      let seasonFactor = 1;
      const sameLY = sameMonthLY.get(p.id) ?? 0;
      const fullLY = fullYearLY.get(p.id) ?? 0;
      if (fullLY > 0 && sameLY > 0) {
        seasonFactor = (sameLY * 12) / fullLY;
        if (!Number.isFinite(seasonFactor) || seasonFactor <= 0) seasonFactor = 1;
        seasonFactor = Math.max(0.5, Math.min(2.5, seasonFactor)); // clamp
      }
      const adjustedRate = dailyRate * seasonFactor;

      // below_min
      if (p.stock_min != null && total <= p.stock_min) {
        newAlerts.push({
          company_id: session.company_id,
          product_id: p.id,
          warehouse_id: null,
          kind: "below_min",
          severity: KIND_SEVERITY.below_min,
          message: `Stock total (${total}) en o por debajo del mínimo (${p.stock_min}).`,
          payload: { total, stock_min: p.stock_min },
        });
      } else if (
        p.lead_time_days != null &&
        adjustedRate > 0 &&
        p.stock_min != null
      ) {
        const daysToMin = Math.max(
          0,
          Math.floor((total - p.stock_min) / adjustedRate),
        );
        if (daysToMin <= p.lead_time_days) {
          newAlerts.push({
            company_id: session.company_id,
            product_id: p.id,
            warehouse_id: null,
            kind: "predictive_low",
            severity: KIND_SEVERITY.predictive_low,
            message:
              `Al ritmo actual (${adjustedRate.toFixed(2)} ud/día` +
              (seasonFactor !== 1 ? ` · estacionalidad ×${seasonFactor.toFixed(2)}` : "") +
              `), llegarás al mínimo en ${daysToMin} día(s) pero el plazo de reposición es ${p.lead_time_days}.`,
            payload: {
              total,
              daily_rate: dailyRate,
              season_factor: seasonFactor,
              adjusted_rate: adjustedRate,
              lead_time_days: p.lead_time_days,
              days_to_min: daysToMin,
            },
          });
        }
      }

      // over_max
      if (p.stock_max != null && total > p.stock_max) {
        newAlerts.push({
          company_id: session.company_id,
          product_id: p.id,
          warehouse_id: null,
          kind: "over_max",
          severity: KIND_SEVERITY.over_max,
          message: `Stock total (${total}) supera el máximo informativo (${p.stock_max}).`,
          payload: { total, stock_max: p.stock_max },
        });
      }

      // no_rotation_Nd: stock>0 y 0 salidas en N días, PERO solo si:
      //  - La primera entrada del producto fue hace >N días.
      //  - La empresa lleva más de min_company_age_days operando.
      //  - La alerta está habilitada en warehouse_settings.
      const firstMov = firstMovementByProduct.get(p.id);
      const stockedLongAgo = firstMov ? new Date(firstMov) <= since90 : false;
      if (
        alertsEnabled.no_rotation_90d &&
        !companyTooYoungForRotationAlerts &&
        total > 0 &&
        outs.length === 0 &&
        stockedLongAgo
      ) {
        newAlerts.push({
          company_id: session.company_id,
          product_id: p.id,
          warehouse_id: null,
          kind: "no_rotation_90d",
          severity: KIND_SEVERITY.no_rotation_90d,
          message: `Sin salidas en ${alertNoRotationDays} días pero hay ${total} ud en stock. Considera dar salida o devolver.`,
          payload: { total, days: alertNoRotationDays },
        });
      }

      // no_lead_time_set
      if (
        alertsEnabled.no_lead_time_set &&
        p.lead_time_days == null &&
        p.stock_managed
      ) {
        newAlerts.push({
          company_id: session.company_id,
          product_id: p.id,
          warehouse_id: null,
          kind: "no_lead_time_set",
          severity: KIND_SEVERITY.no_lead_time_set,
          message: "Producto gestionado sin plazo de reposición. Configura lead_time_days para activar la alerta predictiva.",
          payload: {},
        });
      }
    }

    if (newAlerts.length > 0) {
      const { error: insErr } = await admin.from("stock_alerts").insert(newAlerts);
      if (insErr) return { ok: false, total: 0, error: insErr.message };
    }

    revalidatePath("/almacenes");
    return { ok: true, total: newAlerts.length };
  } catch (e) {
    return { ok: false, total: 0, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function listStockAlerts(filter?: {
  status?: StockAlert["status"];
}): Promise<StockAlert[]> {
  await requireSession();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  let q = supabase
    .from("stock_alerts")
    .select(
      "id, product_id, warehouse_id, kind, severity, message, payload, status, created_at",
    )
    .order("created_at", { ascending: false });
  q = q.eq("status", filter?.status ?? "active");
  const { data: rows } = await q;
  type R = Omit<StockAlert, "product_name" | "warehouse_name">;
  const list = (rows ?? []) as R[];
  if (list.length === 0) return [];
  const productIds = Array.from(new Set(list.map((r) => r.product_id)));
  const whIds = Array.from(
    new Set(list.map((r) => r.warehouse_id).filter(Boolean) as string[]),
  );
  const [pRes, wRes] = await Promise.all([
    supabase.from("products").select("id, name").in("id", productIds),
    whIds.length > 0
      ? supabase.from("warehouses").select("id, name").in("id", whIds)
      : Promise.resolve({ data: [] }),
  ]);
  const pMap = new Map(
    ((pRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
  const wMap = new Map(
    ((wRes.data ?? []) as Array<{ id: string; name: string }>).map((w) => [w.id, w.name]),
  );
  return list.map((r) => ({
    ...r,
    product_name: pMap.get(r.product_id) ?? "?",
    warehouse_name: r.warehouse_id ? wMap.get(r.warehouse_id) ?? null : null,
  }));
}

/**
 * Variante para cron / sistema. Recibe el companyId explícitamente y usa
 * admin client sin requerir sesión interactiva. Misma lógica que
 * recomputeStockAlertsAction.
 */
export async function recomputeStockAlertsForCompany(
  companyId: string,
): Promise<{ ok: boolean; total: number; error?: string }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: prodsRaw, error: prodErr } = await admin
      .from("products")
      .select(
        "id, name, stock_managed, stock_min, stock_max, lead_time_days",
      )
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .eq("stock_managed", true);
    if (prodErr) return { ok: false, total: 0, error: prodErr.message };
    type P = {
      id: string;
      name: string;
      stock_managed: boolean;
      stock_min: number;
      stock_max: number | null;
      lead_time_days: number | null;
    };
    const products = (prodsRaw ?? []) as P[];
    if (products.length === 0) {
      await admin
        .from("stock_alerts")
        .delete()
        .eq("company_id", companyId)
        .eq("status", "active");
      return { ok: true, total: 0 };
    }
    const productIds = products.map((p) => p.id);

    const { data: stocksRaw } = await admin
      .from("warehouse_stock")
      .select("product_id, quantity")
      .in("product_id", productIds);
    const totalByProduct = new Map<string, number>();
    for (const s of (stocksRaw ?? []) as Array<{ product_id: string; quantity: number }>) {
      totalByProduct.set(s.product_id, (totalByProduct.get(s.product_id) ?? 0) + s.quantity);
    }

    const since90 = new Date();
    since90.setDate(since90.getDate() - 90);
    const { data: outs90 } = await admin
      .from("stock_movements")
      .select("product_id, quantity, performed_at")
      .in("product_id", productIds)
      .in("movement_type", ["outbound_install", "outbound_trial", "outbound_maintenance"])
      .gte("performed_at", since90.toISOString());
    type M = { product_id: string; quantity: number; performed_at: string };
    const outsByProduct = new Map<string, M[]>();
    for (const m of (outs90 ?? []) as M[]) {
      if (!outsByProduct.has(m.product_id)) outsByProduct.set(m.product_id, []);
      outsByProduct.get(m.product_id)!.push(m);
    }

    // Primer movimiento (cualquier tipo) por producto, para no marcar
    // "sin rotación 90d" en stock recién creado: si la primera entrada
    // tiene < 90 días, el producto aún no ha tenido tiempo de moverse.
    const { data: firstMovs } = await admin
      .from("stock_movements")
      .select("product_id, performed_at")
      .in("product_id", productIds)
      .order("performed_at", { ascending: true });
    const firstMovementByProduct = new Map<string, string>();
    for (const m of (firstMovs ?? []) as Array<{
      product_id: string;
      performed_at: string;
    }>) {
      if (!firstMovementByProduct.has(m.product_id)) {
        firstMovementByProduct.set(m.product_id, m.performed_at);
      }
    }

    const now = new Date();
    const ly1 = new Date(now);
    ly1.setFullYear(ly1.getFullYear() - 1);
    ly1.setDate(1);
    ly1.setHours(0, 0, 0, 0);
    const ly1End = new Date(ly1);
    ly1End.setMonth(ly1End.getMonth() + 1);
    const lyFullStart = new Date(ly1);
    lyFullStart.setMonth(lyFullStart.getMonth() - 11);
    const { data: outsHistory } = await admin
      .from("stock_movements")
      .select("product_id, quantity, performed_at")
      .in("product_id", productIds)
      .in("movement_type", ["outbound_install", "outbound_trial", "outbound_maintenance"])
      .gte("performed_at", lyFullStart.toISOString())
      .lt("performed_at", ly1End.toISOString());
    const sameMonthLY = new Map<string, number>();
    const fullYearLY = new Map<string, number>();
    for (const m of (outsHistory ?? []) as M[]) {
      const dt = new Date(m.performed_at);
      fullYearLY.set(m.product_id, (fullYearLY.get(m.product_id) ?? 0) + m.quantity);
      if (dt >= ly1 && dt < ly1End) {
        sameMonthLY.set(m.product_id, (sameMonthLY.get(m.product_id) ?? 0) + m.quantity);
      }
    }

    await admin
      .from("stock_alerts")
      .delete()
      .eq("company_id", companyId)
      .eq("status", "active");

    type Insert = {
      company_id: string;
      product_id: string;
      warehouse_id: string | null;
      kind: StockAlert["kind"];
      severity: StockAlert["severity"];
      message: string;
      payload: Record<string, unknown>;
    };
    const newAlerts: Insert[] = [];

    for (const p of products) {
      const total = totalByProduct.get(p.id) ?? 0;
      const outs = outsByProduct.get(p.id) ?? [];
      const totalOut = outs.reduce((s, m) => s + m.quantity, 0);
      const dailyRate = totalOut / 90;
      let seasonFactor = 1;
      const sameLY = sameMonthLY.get(p.id) ?? 0;
      const fullLY = fullYearLY.get(p.id) ?? 0;
      if (fullLY > 0 && sameLY > 0) {
        seasonFactor = (sameLY * 12) / fullLY;
        if (!Number.isFinite(seasonFactor) || seasonFactor <= 0) seasonFactor = 1;
        seasonFactor = Math.max(0.5, Math.min(2.5, seasonFactor));
      }
      const adjustedRate = dailyRate * seasonFactor;

      if (p.stock_min != null && total <= p.stock_min) {
        newAlerts.push({
          company_id: companyId,
          product_id: p.id,
          warehouse_id: null,
          kind: "below_min",
          severity: KIND_SEVERITY.below_min,
          message: `Stock total (${total}) en o por debajo del mínimo (${p.stock_min}).`,
          payload: { total, stock_min: p.stock_min },
        });
      } else if (p.lead_time_days != null && adjustedRate > 0 && p.stock_min != null) {
        const daysToMin = Math.max(0, Math.floor((total - p.stock_min) / adjustedRate));
        if (daysToMin <= p.lead_time_days) {
          newAlerts.push({
            company_id: companyId,
            product_id: p.id,
            warehouse_id: null,
            kind: "predictive_low",
            severity: KIND_SEVERITY.predictive_low,
            message:
              `Al ritmo actual (${adjustedRate.toFixed(2)} ud/día` +
              (seasonFactor !== 1 ? ` · estacionalidad ×${seasonFactor.toFixed(2)}` : "") +
              `), llegarás al mínimo en ${daysToMin} día(s) pero el plazo de reposición es ${p.lead_time_days}.`,
            payload: {
              total,
              daily_rate: dailyRate,
              season_factor: seasonFactor,
              adjusted_rate: adjustedRate,
              lead_time_days: p.lead_time_days,
              days_to_min: daysToMin,
            },
          });
        }
      }
      if (p.stock_max != null && total > p.stock_max) {
        newAlerts.push({
          company_id: companyId,
          product_id: p.id,
          warehouse_id: null,
          kind: "over_max",
          severity: KIND_SEVERITY.over_max,
          message: `Stock total (${total}) supera el máximo informativo (${p.stock_max}).`,
          payload: { total, stock_max: p.stock_max },
        });
      }
      const firstMov = firstMovementByProduct.get(p.id);
      const stockedLongAgo = firstMov ? new Date(firstMov) <= since90 : false;
      if (total > 0 && outs.length === 0 && stockedLongAgo) {
        newAlerts.push({
          company_id: companyId,
          product_id: p.id,
          warehouse_id: null,
          kind: "no_rotation_90d",
          severity: KIND_SEVERITY.no_rotation_90d,
          message: `Sin salidas en 90 días pero hay ${total} ud en stock. Considera dar salida o devolver.`,
          payload: { total },
        });
      }
      if (p.lead_time_days == null && p.stock_managed) {
        newAlerts.push({
          company_id: companyId,
          product_id: p.id,
          warehouse_id: null,
          kind: "no_lead_time_set",
          severity: KIND_SEVERITY.no_lead_time_set,
          message: "Producto gestionado sin plazo de reposición. Configura lead_time_days para activar la alerta predictiva.",
          payload: {},
        });
      }
    }

    if (newAlerts.length > 0) {
      const { error: insErr } = await admin.from("stock_alerts").insert(newAlerts);
      if (insErr) return { ok: false, total: 0, error: insErr.message };
    }
    return { ok: true, total: newAlerts.length };
  } catch (e) {
    return { ok: false, total: 0, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function dismissAlertAction(id: string): Promise<void> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // SEGURIDAD: admin salta RLS → filtrar por company_id.
  await admin
    .from("stock_alerts")
    .update({
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      dismissed_by: session.user_id,
    })
    .eq("id", id)
    .eq("company_id", session.company_id);
  revalidatePath("/almacenes");
}

export async function dismissAlertSafeAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await dismissAlertAction(id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
