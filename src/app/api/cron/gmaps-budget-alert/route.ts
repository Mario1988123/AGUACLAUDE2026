import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { notifyByRoles } from "@/modules/notifications/notifier";
import { sendViaSmtp } from "@/modules/mailing/smtp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const FREE_TIER_USD = 200;
const WARN_PCT = 0.8;

/**
 * Cron diario que recorre todas las empresas con gmaps_mode != disabled
 * y envía aviso por email + notificación in-app si:
 *  · current_month_usd >= 80% del free tier ($160 / $200) — aviso amistoso
 *  · current_month_usd >= cap mensual configurado — aviso crítico
 *  · current_day_usd >= cap diario — aviso crítico
 *
 * Idempotente por día: usa company_settings.gmaps_alert_last_sent_day
 * para no spamear al admin con el mismo aviso varias veces el mismo día.
 *
 * Auth: header `x-cron-secret` o `Authorization: Bearer CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const today = new Date().toISOString().slice(0, 10);
  const stats = { scanned: 0, warned: 0, capped: 0, skipped_already_sent: 0 };

  const { data: companies } = await admin
    .from("companies")
    .select(
      "id, name, gmaps_mode, gmaps_monthly_cap_usd, gmaps_daily_cap_usd",
    )
    .neq("gmaps_mode", "disabled");

  for (const c of (companies ?? []) as Array<{
    id: string;
    name: string | null;
    gmaps_mode: string;
    gmaps_monthly_cap_usd: number | null;
    gmaps_daily_cap_usd: number | null;
  }>) {
    stats.scanned++;
    const { data: cs } = await admin
      .from("company_settings")
      .select("gmaps_alert_email, gmaps_alert_last_sent_day")
      .eq("company_id", c.id)
      .maybeSingle();
    const alertEmail = (cs as { gmaps_alert_email: string | null } | null)
      ?.gmaps_alert_email;
    const lastSent = (
      cs as { gmaps_alert_last_sent_day: string | null } | null
    )?.gmaps_alert_last_sent_day;
    if (lastSent === today) {
      stats.skipped_already_sent++;
      continue;
    }

    // Sumar consumo mes actual y día actual
    const now = new Date();
    const monthStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      1,
    ).toISOString();
    const dayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    ).toISOString();
    const { data: mRows } = await admin
      .from("google_api_usage")
      .select("cost_micro_usd")
      .eq("company_id", c.id)
      .eq("success", true)
      .gte("called_at", monthStart);
    const monthUsd =
      ((mRows ?? []) as Array<{ cost_micro_usd: number }>).reduce(
        (s, r) => s + Number(r.cost_micro_usd),
        0,
      ) / 1_000_000;
    const { data: dRows } = await admin
      .from("google_api_usage")
      .select("cost_micro_usd")
      .eq("company_id", c.id)
      .eq("success", true)
      .gte("called_at", dayStart);
    const dayUsd =
      ((dRows ?? []) as Array<{ cost_micro_usd: number }>).reduce(
        (s, r) => s + Number(r.cost_micro_usd),
        0,
      ) / 1_000_000;

    const monthlyCap = Number(c.gmaps_monthly_cap_usd ?? 50);
    const dailyCap = Number(c.gmaps_daily_cap_usd ?? 10);
    const reachedFreeTier = monthUsd >= FREE_TIER_USD * WARN_PCT;
    const reachedCapMonth = monthUsd >= monthlyCap;
    const reachedCapDay = dayUsd >= dailyCap;

    if (!reachedFreeTier && !reachedCapMonth && !reachedCapDay) continue;

    const severity: "warning" | "error" =
      reachedCapMonth || reachedCapDay ? "error" : "warning";
    let subject: string;
    let body: string;
    if (reachedCapMonth) {
      subject = `[${c.name ?? "Empresa"}] Google Maps: tope mensual alcanzado`;
      body = `Has llegado al tope mensual de $${monthlyCap} (consumo: $${monthUsd.toFixed(2)}). El módulo Google Maps Tools está cayendo a OpenStreetMap hasta el día 1 del próximo mes. Aumenta el tope o espera.`;
      stats.capped++;
    } else if (reachedCapDay) {
      subject = `[${c.name ?? "Empresa"}] Google Maps: tope diario alcanzado`;
      body = `Has llegado al tope diario de $${dailyCap} (consumo hoy: $${dayUsd.toFixed(2)}). El módulo cae a OpenStreetMap hasta mañana.`;
      stats.capped++;
    } else {
      subject = `[${c.name ?? "Empresa"}] Google Maps: 80% del free tier`;
      body = `Llevas $${monthUsd.toFixed(2)} este mes en Google Maps Platform — has superado el 80% del free tier de Google ($${FREE_TIER_USD}). A partir de $${FREE_TIER_USD} Google empezará a facturar a tu tarjeta. Revisa el dashboard en /configuracion/google-maps.`;
      stats.warned++;
    }

    if (alertEmail) {
      try {
        await sendViaSmtp({
          companyId: c.id,
          senderUserId: null, // sistema
          to: alertEmail,
          subject,
          html: `<p>${body}</p><p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ""}/configuracion/google-maps">Abrir dashboard</a></p>`,
          text: body,
          sendType: "automated",
          triggerEvent: "gmaps_budget_alert",
        });
      } catch (e) {
        console.error("[gmaps-budget-alert] email failed", c.id, e);
      }
    }

    try {
      await notifyByRoles(c.id, ["company_admin"], {
        kind: "gmaps.budget_alert",
        severity,
        title: subject,
        body,
        action_url: "/configuracion/google-maps",
      });
    } catch {
      /* no-op */
    }

    // Marcar como enviado hoy (idempotencia)
    try {
      await admin
        .from("company_settings")
        .update({ gmaps_alert_last_sent_day: today })
        .eq("company_id", c.id);
    } catch {
      /* no-op */
    }
  }

  return NextResponse.json({ ok: true, stats });
}
