import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { verifyCronAuth } from "@/shared/lib/auth/cron";
import { notifyByRoles } from "@/modules/notifications/notifier";
import { startCronRun } from "@/shared/lib/cron/telemetry";
import { companiesWithModuleDisabled } from "@/shared/lib/auth/module-guard";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import {
  claveDiaMadrid,
  diferenciaDiasClave,
} from "@/modules/scheduling/fechas-madrid";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Recordatorios de impago (auditoría 2026-10-01, C2).
 *
 * Antes iban al final de /api/cron/daily, detrás del bucle de churn que
 * agotaba los 300 s: no se envió nunca ninguno (invoice_reminders_sent = 0).
 * Ahora tienen su propio cron, a las 08:00 UTC (10:00 en verano, 09:00 en
 * invierno en Madrid) [decide: horario de oficina, no a medianoche], con
 * presupuesto de tiempo y registro de fin en cron_runs.
 *
 * Idempotencia: un recordatorio por factura y nivel (invoice_reminders_sent).
 * Si una ejecución se corta por tiempo, la siguiente sigue por donde iba.
 */

const PRESUPUESTO_MS = 240_000;

export async function GET(req: NextRequest) {
  const denied = verifyCronAuth(req);
  if (denied) return denied;

  const tracker = await startCronRun("invoice-reminders");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const offInvoicing = await companiesWithModuleDisabled("invoicing");

  // ===== Recordatorios de impago automáticos (decisión 2026-05-20) =====
  // Para cada factura vencida con saldo pendiente, mandar el recordatorio
  // correspondiente al nivel de retraso:
  //  · 7d  → recordatorio suave (template payment_reminder_1)
  //  · 14d → recordatorio formal (template payment_reminder_2)
  //  · 30d → requerimiento (template payment_reminder_3)
  //  · 45d → alerta admin "considera vía legal" (no envío al cliente)
  // Idempotencia vía invoice_reminders_sent.
  const remindersStats = {
    level1: 0,
    level2: 0,
    level3: 0,
    legal_alerts: 0,
    errors: 0,
    skipped_no_consent: 0,
    cut_by_time: false,
  };
  try {
    const now = Date.now();
    // Día natural de Madrid: los días de retraso se cuentan por fecha, no por
    // horas UTC (auditoría 2026-10-01).
    const hoyMadrid = claveDiaMadrid(new Date(now));
    // `pending_cents` NO existe en la tabla: pedirla hacía fallar el select
    // entero y ningún recordatorio salió jamás. Lo pendiente es
    // total_cents − cobros de invoice_payments, igual que en getInvoice().
    // fetchAllRows: PostgREST corta en 1.000 filas.
    const overdue = await fetchAllRows<Record<string, unknown>>(
      (from, to) =>
        admin
          .from("invoices")
          .select(
            "id, company_id, customer_id, customer_fiscal_snapshot, full_reference, total_cents, due_date, status",
          )
          .in("status", ["issued", "overdue"])
          .lt("due_date", hoyMadrid)
          .is("deleted_at", null)
          .order("id")
          .range(from, to),
      { label: "cron/invoice-reminders" },
    );
    type Inv = {
      id: string;
      company_id: string;
      customer_id: string | null;
      customer_fiscal_snapshot: Record<string, unknown> | null;
      full_reference: string;
      total_cents: number;
      due_date: string;
      status: string;
    };
    const overdueList = (overdue ?? []) as Inv[];
    // Cobros parciales de todas ellas en una sola consulta.
    const paidByInvoice = new Map<string, number>();
    // Por tramos de 100 ids para no pasar el límite de longitud de URL.
    for (let i = 0; i < overdueList.length; i += 100) {
      const tramo = overdueList.slice(i, i + 100).map((inv) => inv.id);
      const { data: paysData, error: paysErr } = await admin
        .from("invoice_payments")
        .select("invoice_id, amount_cents")
        .in("invoice_id", tramo);
      // Sin saber lo cobrado no se puede reclamar nada: mejor no enviar.
      if (paysErr) throw new Error(`invoice_payments: ${paysErr.message}`);
      for (const p of (paysData ?? []) as Array<{
        invoice_id: string;
        amount_cents: number;
      }>) {
        paidByInvoice.set(
          p.invoice_id,
          (paidByInvoice.get(p.invoice_id) ?? 0) + (p.amount_cents ?? 0),
        );
      }
    }
    for (const inv of overdueList) {
      if (offInvoicing.has(inv.company_id)) continue;
      if (Date.now() - tracker.startedAt > PRESUPUESTO_MS) {
        remindersStats.cut_by_time = true;
        break;
      }
      const pendingCents = inv.total_cents - (paidByInvoice.get(inv.id) ?? 0);
      if (pendingCents <= 0) continue;
      try {
        const daysOverdue = diferenciaDiasClave(inv.due_date.slice(0, 10), hoyMadrid);
        let level: 1 | 2 | 3 | null = null;
        if (daysOverdue >= 45) {
          // No envío al cliente — solo notif admin, UNA vez por factura.
          // Antes: `daysOverdue === 45 || 46` → se avisaba dos veces, y nunca
          // si el cron no corría esos dos días.
          const { count: yaAvisada } = await admin
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("company_id", inv.company_id)
            .eq("kind", "invoice.legal_action_suggested")
            .eq("subject_id", inv.id);
          if ((yaAvisada ?? 0) === 0) {
            await notifyByRoles(
              inv.company_id,
              ["company_admin", "commercial_director"],
              {
                kind: "invoice.legal_action_suggested",
                severity: "warning",
                title: `Factura ${inv.full_reference} +45d vencida`,
                body: `Considera vía legal. Cliente impagado más de 45 días por ${(pendingCents / 100).toFixed(2)}€.`,
                subject_type: "invoice",
                subject_id: inv.id,
                action_url: `/facturas/${inv.id}`,
              },
            );
            remindersStats.legal_alerts += 1;
          }
          continue;
        } else if (daysOverdue >= 30) level = 3;
        else if (daysOverdue >= 14) level = 2;
        else if (daysOverdue >= 7) level = 1;
        if (!level) continue;

        // ¿Ya enviamos este nivel?
        const { count: already } = await admin
          .from("invoice_reminders_sent")
          .select("id", { count: "exact", head: true })
          .eq("invoice_id", inv.id)
          .eq("level", level);
        if ((already ?? 0) > 0) continue;

        // Consentimiento + email cliente
        const snap = inv.customer_fiscal_snapshot ?? {};
        const recipientEmail = (snap as { email?: string }).email ?? null;
        if (!recipientEmail) {
          remindersStats.skipped_no_consent += 1;
          continue;
        }

        // RGPD: `customers.commercial_consent` no existe — el consentimiento
        // vive en `customer_consents`. Un recordatorio de impago es
        // transaccional, no marketing, así que se mira `data_processing`,
        // igual que los emails de incidencia (incidents/email-from-cron.ts).
        let hasConsent = true;
        if (inv.customer_id) {
          try {
            const { data: consent } = await admin
              .from("customer_consents")
              .select("granted")
              .eq("customer_id", inv.customer_id)
              .eq("kind", "data_processing")
              .order("granted_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            hasConsent = (consent as { granted?: boolean } | null)?.granted !== false;
          } catch {
            /* */
          }
        }
        if (!hasConsent) {
          remindersStats.skipped_no_consent += 1;
          // Crear tarea agenda al admin: llamar al cliente
          try {
            await admin.from("agenda_events").insert({
              company_id: inv.company_id,
              // "task" no existe en agenda_event_kind (auditoría I3).
              kind: "reminder",
              title: `Llamar — factura ${inv.full_reference} impagada ${daysOverdue}d`,
              description: `El cliente no acepta comunicaciones comerciales. Pendiente: ${(pendingCents / 100).toFixed(2)}€.`,
              starts_at: new Date(now + 24 * 3600000).toISOString(),
              subject_type: "invoice",
              subject_id: inv.id,
            });
          } catch {
            /* */
          }
          continue;
        }

        // Registrar recordatorio (idempotencia primero — un solo recordatorio
        // por nivel y factura, aunque el envío falle: si reintentamos al día
        // siguiente la siguiente vuelta del cron no duplica).
        const { error: errReg } = await admin.from("invoice_reminders_sent").insert({
          invoice_id: inv.id,
          level,
          channel: "email",
          recipient_email: recipientEmail,
          template_key: `payment_reminder_${level}`,
        });
        // Si no se pudo registrar, NO se envía: sin registro se reenviaría
        // el mismo recordatorio cada día.
        if (errReg) throw new Error(`invoice_reminders_sent: ${errReg.message}`);

        // Envío REAL del recordatorio al cliente vía SMTP (auditoría 2026-05-30
        // detectó que antes solo notificaba al admin internamente y NO al
        // cliente — el campo "ya le mandamos 3 recordatorios" era falso).
        try {
          const templateKey = `payment_reminder_${level}`;
          // Plantilla per-empresa; fallback al catálogo de sistema.
          const { data: tplRow } = await admin
            .from("email_templates")
            .select("id, subject, body_html, kind")
            .eq("company_id", inv.company_id)
            .eq("key", templateKey)
            .eq("is_active", true)
            .maybeSingle();
          let tplId: string | null = null;
          let tplSubject = "";
          let tplBody = "";
          let tplKind = "transactional";
          if (tplRow) {
            const tr = tplRow as {
              id: string;
              subject: string;
              body_html: string;
              kind: string;
            };
            tplId = tr.id;
            tplSubject = tr.subject;
            tplBody = tr.body_html;
            tplKind = tr.kind;
          } else {
            const { getSystemTemplateByKey } = await import(
              "@/modules/mailing/system-templates"
            );
            const sys = getSystemTemplateByKey(templateKey);
            if (sys) {
              tplSubject = sys.subject;
              tplBody = sys.body_html;
            } else {
              // Genérico mínimo si no hay seed: que al menos llegue algo
              // útil. (system-templates debería tener payment_reminder_*).
              tplSubject = `Recordatorio: factura ${inv.full_reference} pendiente`;
              tplBody = `<p>Hola,</p><p>Te recordamos que la factura <b>${inv.full_reference}</b> de ${(pendingCents / 100).toFixed(2)} € está pendiente de pago desde hace ${daysOverdue} días.</p><p>Si ya la has abonado, ignora este aviso. Si no, ponte en contacto con nosotros.</p>`;
            }
          }

          const snapFull = inv.customer_fiscal_snapshot as
            | Record<string, unknown>
            | null;
          const firstName = (snapFull?.first_name as string | null) ?? "";
          const customerName =
            (snapFull?.trade_name as string | null) ??
            (snapFull?.legal_name as string | null) ??
            `${firstName} ${snapFull?.last_name ?? ""}`.trim() ??
            "Cliente";
          const vars: Record<string, string> = {
            customer_first_name: firstName || customerName,
            customer_name: customerName,
            invoice_ref: inv.full_reference ?? "",
            days_overdue: String(daysOverdue),
            pending_amount: (pendingCents / 100).toFixed(2),
            due_date: new Date(inv.due_date).toLocaleDateString("es-ES"),
          };
          const render = (s: string) =>
            s.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
              vars[k] !== undefined ? vars[k] : `{{${k}}}`,
            );

          const { loadCompanyEmailContext } = await import(
            "@/modules/mailing/company-context"
          );
          const ctx = await loadCompanyEmailContext(inv.company_id, admin);
          const { buildEmailHtml } = await import("@/modules/mailing/templates");
          const subjectRendered = render(tplSubject);
          const htmlWrapped = buildEmailHtml({
            body_html: render(tplBody),
            company: ctx.company,
            branding: ctx.branding,
            kind: "transactional",
          });

          const { sendViaSmtp } = await import("@/modules/mailing/smtp");
          const sendRes = await sendViaSmtp({
            companyId: inv.company_id,
            senderUserId: null,
            to: recipientEmail,
            toName: customerName,
            subject: subjectRendered,
            html: htmlWrapped,
            sendType: "automated",
            triggerEvent: "payment_reminder",
            relatedType: "invoice",
            relatedId: inv.id,
          });

          try {
            await admin.from("email_sends").insert({
              company_id: inv.company_id,
              template_id: tplId,
              template_key: templateKey,
              kind: tplKind,
              to_email: recipientEmail,
              to_name: customerName,
              subject: subjectRendered,
              body_html: htmlWrapped,
              customer_id: inv.customer_id,
              related_subject_type: "invoice",
              related_subject_id: inv.id,
              status: sendRes.ok ? "sent" : "failed",
              error_message: sendRes.ok ? null : sendRes.error,
              sent_at: sendRes.ok ? new Date().toISOString() : null,
              send_type: "automated",
              trigger_event: "payment_reminder",
              from_account_type: sendRes.ok ? sendRes.accountType : null,
              resend_id: sendRes.ok ? sendRes.resend_id ?? null : null,
            });
          } catch {
            /* fail-soft del registro */
          }
        } catch (e) {
          tracker.error("payment-reminder-send", e);
        }

        // Notificar también al admin internamente para que vea el resumen.
        await notifyByRoles(
          inv.company_id,
          ["company_admin", "commercial_director"],
          {
            kind: `invoice.reminder_${level}_sent`,
            severity: level === 3 ? "warning" : "info",
            title: `Recordatorio nivel ${level}: ${inv.full_reference}`,
            body: `Factura impagada ${daysOverdue} días. ${(pendingCents / 100).toFixed(2)}€.`,
            subject_type: "invoice",
            subject_id: inv.id,
            action_url: `/facturas/${inv.id}`,
          },
        );
        if (level === 1) remindersStats.level1 += 1;
        if (level === 2) remindersStats.level2 += 1;
        if (level === 3) remindersStats.level3 += 1;

        // Marcar factura como overdue si no lo está aún
        if (inv.status === "issued") {
          await admin
            .from("invoices")
            .update({ status: "overdue" })
            .eq("id", inv.id);
        }
      } catch (e) {
        remindersStats.errors += 1;
        tracker.error("invoice-reminder", e);
      }
    }
  } catch (e) {
    tracker.error("invoice-reminders-outer", e);
  }

  await tracker.finish({ summary: { invoice_reminders: remindersStats } });
  return NextResponse.json({
    ok: tracker.errors.length === 0,
    stats: remindersStats,
    ranAt: new Date().toISOString(),
  });
}
