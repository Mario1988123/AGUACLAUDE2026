import "server-only";
import { fetchAllRows } from "@/shared/lib/supabase/fetch-all";
import { notify, notifyByRoles } from "@/modules/notifications/notifier";
import {
  DIAS_ENTRE_AVISOS,
  ESTADOS_LEAD_ABIERTO,
  diasInactividad,
  leadsInactivos,
} from "./inactividad-logica";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * Aviso de leads inactivos (decisión de Mario 12-11, plan
 * docs/PLAN_REVISION_LEADS.md §6): SOLO AVISA, nunca quita el lead ni cambia
 * su estado. Sustituye a los dos crons antiguos (caducidad 15/30 días y
 * «lead parado» 14 días), que desasignaban y nadie repartía después.
 *
 *  - Lead asignado sin actividad en N días (lead_stale_days, por defecto 40)
 *    → aviso al comercial, repetido como mucho cada 7 días.
 *  - Resumen semanal al admin: cuántos leads llevan N días parados y cuántos
 *    hay en la bolsa sin repartir (reparte el admin).
 *
 * Actividad = alta / asignación / edición del lead, cualquier evento del lead,
 * tareas de agenda del lead (recientes o futuras) o una prueba gratuita abierta.
 */
export async function avisarLeadsInactivos(
  admin: Admin,
  fueraDeTiempo: (seccion: string) => boolean,
): Promise<{ avisos_comercial: number; resumenes_admin: number; errores: number }> {
  const stats = { avisos_comercial: 0, resumenes_admin: 0, errores: 0 };

  // select("*"): si la migración de lead_stale_days no está aplicada, la
  // columna simplemente no viene y se usan 40 días. No rompe.
  const { data: settings } = await admin.from("company_settings").select("*");
  const settingsPorEmpresa = new Map<string, Record<string, unknown>>();
  for (const s of (settings ?? []) as Array<Record<string, unknown>>) {
    settingsPorEmpresa.set(String(s.company_id), s);
  }

  type LeadAbierto = {
    id: string;
    company_id: string;
    assigned_user_id: string | null;
    created_at: string;
    assigned_at: string | null;
    updated_at: string | null;
    party_kind: string;
    legal_name: string | null;
    trade_name: string | null;
    first_name: string | null;
    last_name: string | null;
  };
  const abiertos = await fetchAllRows<LeadAbierto>(
    (from, to) =>
      admin
        .from("leads")
        .select(
          "id, company_id, assigned_user_id, created_at, assigned_at, updated_at, party_kind, legal_name, trade_name, first_name, last_name",
        )
        .in("status", ESTADOS_LEAD_ABIERTO as unknown as string[])
        .is("deleted_at", null)
        .order("id")
        .range(from, to),
    { label: "cron/daily leads abiertos" },
  );

  const porEmpresa = new Map<string, LeadAbierto[]>();
  for (const l of abiertos) {
    const arr = porEmpresa.get(l.company_id) ?? [];
    arr.push(l);
    porEmpresa.set(l.company_id, arr);
  }

  const haceAvisos = new Date(Date.now() - DIAS_ENTRE_AVISOS * 86_400_000).toISOString();

  for (const [companyId, leads] of porEmpresa) {
    if (fueraDeTiempo("leads-inactivos")) break;
    try {
      const dias = diasInactividad(settingsPorEmpresa.get(companyId));
      const corte = new Date(Date.now() - dias * 86_400_000).toISOString();
      const asignados = leads.filter((l) => !!l.assigned_user_id);
      const enBolsa = leads.length - asignados.length;

      // Candidatos por fecha propia; luego se descartan los que tienen
      // actividad externa reciente.
      const candidatos = leadsInactivos(asignados, dias, new Set());
      const conActividad = new Set<string>();
      for (let i = 0; i < candidatos.length; i += 150) {
        const ids = candidatos.slice(i, i + 150).map((l) => l.id);
        const [ev, ag, ft] = await Promise.all([
          admin
            .from("events")
            .select("subject_id")
            .eq("company_id", companyId)
            .eq("subject_type", "lead")
            .in("subject_id", ids)
            .gte("occurred_at", corte),
          admin
            .from("agenda_events")
            .select("subject_id")
            .eq("company_id", companyId)
            .eq("subject_type", "lead")
            .in("subject_id", ids)
            .is("deleted_at", null)
            .neq("status", "cancelled")
            .gte("starts_at", corte),
          admin
            .from("free_trials")
            .select("lead_id")
            .eq("company_id", companyId)
            .in("lead_id", ids)
            .is("deleted_at", null)
            .in("status", ["draft", "scheduled", "installed"]),
        ]);
        for (const r of (ev.data ?? []) as Array<{ subject_id: string }>) conActividad.add(r.subject_id);
        for (const r of (ag.data ?? []) as Array<{ subject_id: string }>) conActividad.add(r.subject_id);
        for (const r of (ft.data ?? []) as Array<{ lead_id: string }>) conActividad.add(r.lead_id);
        // Si una consulta falla, ante la duda no se avisa de esos leads.
        if (ev.error || ag.error || ft.error) ids.forEach((id) => conActividad.add(id));
      }
      const inactivos = candidatos.filter((l) => !conActividad.has(l.id));

      // Aviso al comercial, como mucho uno cada 7 días por lead.
      if (inactivos.length > 0) {
        const yaAvisados = new Set<string>();
        for (let i = 0; i < inactivos.length; i += 150) {
          const ids = inactivos.slice(i, i + 150).map((l) => l.id);
          const { data: prev } = await admin
            .from("notifications")
            .select("subject_id")
            .eq("company_id", companyId)
            .eq("kind", "lead.stale")
            .in("subject_id", ids)
            .gte("created_at", haceAvisos);
          for (const r of (prev ?? []) as Array<{ subject_id: string }>) yaAvisados.add(r.subject_id);
        }
        for (const l of inactivos) {
          if (yaAvisados.has(l.id) || !l.assigned_user_id) continue;
          const nombre =
            l.party_kind === "company"
              ? l.trade_name || l.legal_name || "Sin nombre"
              : `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Sin nombre";
          try {
            await notify({
              company_id: companyId,
              recipient_user_id: l.assigned_user_id,
              kind: "lead.stale",
              severity: "warning",
              title: "Lead sin actividad",
              body: `${nombre}: ${dias} días sin actividad. Sigue siendo tuyo; registra el contacto o avisa al admin si no lo vas a trabajar.`,
              subject_type: "lead",
              subject_id: l.id,
              action_url: `/leads/${l.id}`,
            });
            stats.avisos_comercial += 1;
          } catch {
            stats.errores += 1;
          }
        }
      }

      // Resumen semanal al admin (reparte la bolsa).
      if (inactivos.length > 0 || enBolsa > 0) {
        const { count: resumenReciente } = await admin
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("kind", "lead.stale_summary")
          .gte("created_at", haceAvisos);
        if ((resumenReciente ?? 0) === 0) {
          const partes: string[] = [];
          if (enBolsa > 0) partes.push(`${enBolsa} lead${enBolsa === 1 ? "" : "s"} en la bolsa sin repartir`);
          if (inactivos.length > 0)
            partes.push(`${inactivos.length} asignado${inactivos.length === 1 ? "" : "s"} con ${dias} días sin actividad`);
          await notifyByRoles(companyId, ["company_admin"], {
            kind: "lead.stale_summary",
            severity: "warning",
            title: "Leads por revisar",
            body: `${partes.join(" y ")}. Los comerciales conservan sus leads; repartir la bolsa es cosa del admin.`,
            action_url: enBolsa > 0 ? "/leads?assigned=unassigned" : "/leads?sort=oldest",
          });
          stats.resumenes_admin += 1;
        }
      }
    } catch (e) {
      console.error("[cron/daily] aviso de leads inactivos falló en", companyId, e);
      stats.errores += 1;
    }
  }

  return stats;
}
