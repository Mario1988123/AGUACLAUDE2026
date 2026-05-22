"use server";

import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import {
  isLevel1,
  isLevel2,
  resolveVisibleUserIds,
} from "@/shared/lib/auth/role-scope";

export interface PointsBreakdownLine {
  id: string;
  awarded_at: string;
  reason: string;
  points: number;
  subject_type: string | null;
  subject_id: string | null;
  contract_id: string | null;
  installation_id: string | null;
  /** Texto humano corto sobre qué fue lo que originó el punto, si lo
   *  podemos resolver desde subject_type/subject_id sin abrir la entidad
   *  completa. Ej. "Contrato CTR-0042" o "Lead nuevo de Juan Pérez". */
  subject_label: string | null;
  metadata: Record<string, unknown> | null;
}

export interface PointsBreakdown {
  user_id: string;
  user_name: string;
  year: number;
  month: number;
  total_points: number;
  total_equipments: number;
  lines: PointsBreakdownLine[];
}

const SALE_REASONS = new Set(["sale", "sale_with_discount", "sale_tmk_split"]);

interface PartyLike {
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
}

function partyName(p: PartyLike | null | undefined, fallback: string): string {
  if (!p) return fallback;
  const company = p.trade_name ?? p.legal_name;
  const person = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return company || person || fallback;
}

/**
 * Desglose detallado de los puntos de un usuario en un mes concreto.
 * Visibilidad:
 *  - admin (nivel 1) / superadmin → cualquier user_id de su empresa.
 *  - director (nivel 2)           → self + miembros del team_assignments.
 *  - nivel 3 (sales_rep / tmk / installer) → solo self.
 *
 * Devuelve result pattern. Si la sesión no tiene scope sobre el user_id
 * solicitado, NO devuelve los datos — error legible.
 */
export async function getPointsBreakdownSafeAction(
  userId: string,
  year?: number,
  month?: number,
): Promise<
  | { ok: true; data: PointsBreakdown }
  | { ok: false; error: string }
> {
  try {
    const session = await requireSession();
    if (!session.company_id) {
      return { ok: false, error: "Sesión sin empresa" };
    }

    // Scope check
    if (!isLevel1(session)) {
      if (isLevel2(session)) {
        const visible = await resolveVisibleUserIds(session);
        if (visible !== null && !visible.includes(userId)) {
          return {
            ok: false,
            error:
              "No tienes permiso para ver el desglose de este usuario (solo admin o el propio usuario y su director directo).",
          };
        }
      } else {
        // Nivel 3: solo self
        if (userId !== session.user_id) {
          return {
            ok: false,
            error: "Solo puedes ver tu propio desglose.",
          };
        }
      }
    }

    const now = new Date();
    const y = year ?? now.getFullYear();
    const m = month ?? now.getMonth() + 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any;

    const { data: ledger, error: ledgerErr } = await admin
      .from("points_ledger")
      .select(
        "id, awarded_at, reason, points, subject_type, subject_id, contract_id, installation_id, metadata",
      )
      .eq("company_id", session.company_id)
      .eq("user_id", userId)
      .eq("period_year", y)
      .eq("period_month", m)
      .order("awarded_at", { ascending: false });
    if (ledgerErr) return { ok: false, error: ledgerErr.message };

    type Raw = {
      id: string;
      awarded_at: string;
      reason: string;
      points: number;
      subject_type: string | null;
      subject_id: string | null;
      contract_id: string | null;
      installation_id: string | null;
      metadata: Record<string, unknown> | string | null;
    };
    const rows = (ledger ?? []) as Raw[];

    // Parsear metadata defensivo (puede venir como string en JSON columns)
    const parsed = rows.map((r) => {
      let meta: Record<string, unknown> | null = null;
      if (r.metadata && typeof r.metadata === "object") {
        meta = r.metadata as Record<string, unknown>;
      } else if (typeof r.metadata === "string") {
        try {
          meta = JSON.parse(r.metadata);
        } catch {
          meta = null;
        }
      }
      return { ...r, metadata: meta };
    });

    // Resolver labels de los subjects (contratos, leads, instalaciones, etc.)
    const contractIds = new Set<string>();
    const leadIds = new Set<string>();
    const installationIds = new Set<string>();
    const maintenanceIds = new Set<string>();
    const incidentIds = new Set<string>();
    for (const r of parsed) {
      if (r.subject_type === "contract" && r.subject_id) contractIds.add(r.subject_id);
      if (r.subject_type === "lead" && r.subject_id) leadIds.add(r.subject_id);
      if (r.subject_type === "installation" && r.subject_id)
        installationIds.add(r.subject_id);
      if (r.subject_type === "maintenance" && r.subject_id)
        maintenanceIds.add(r.subject_id);
      if (r.subject_type === "incident" && r.subject_id)
        incidentIds.add(r.subject_id);
    }

    const contractLabel = new Map<string, string>();
    const leadLabel = new Map<string, string>();
    const installationLabel = new Map<string, string>();
    const maintenanceLabel = new Map<string, string>();
    const incidentLabel = new Map<string, string>();

    // Contratos → reference_code + cliente
    if (contractIds.size > 0) {
      const { data } = await admin
        .from("contracts")
        .select(
          "id, reference_code, customers(legal_name, trade_name, first_name, last_name)",
        )
        .in("id", Array.from(contractIds));
      type CR = {
        id: string;
        reference_code: string | null;
        customers: PartyLike | null;
      };
      for (const c of (data ?? []) as CR[]) {
        const cust = partyName(c.customers, "");
        const ref = c.reference_code ?? c.id.slice(0, 8);
        contractLabel.set(c.id, cust ? `${ref} · ${cust}` : ref);
      }
    }
    if (leadIds.size > 0) {
      const { data } = await admin
        .from("leads")
        .select("id, party_kind, legal_name, trade_name, first_name, last_name")
        .in("id", Array.from(leadIds));
      type LR = {
        id: string;
        party_kind: string;
        legal_name: string | null;
        trade_name: string | null;
        first_name: string | null;
        last_name: string | null;
      };
      for (const l of (data ?? []) as LR[]) {
        const company = l.trade_name ?? l.legal_name;
        const person = [l.first_name, l.last_name].filter(Boolean).join(" ");
        const label =
          l.party_kind === "company"
            ? company ?? person ?? l.id.slice(0, 8)
            : person || company || l.id.slice(0, 8);
        leadLabel.set(l.id, label);
      }
    }
    if (installationIds.size > 0) {
      const { data } = await admin
        .from("installations")
        .select(
          "id, scheduled_at, customers(legal_name, trade_name, first_name, last_name)",
        )
        .in("id", Array.from(installationIds));
      type IR = {
        id: string;
        scheduled_at: string | null;
        customers: PartyLike | null;
      };
      for (const i of (data ?? []) as IR[]) {
        const when = i.scheduled_at
          ? new Date(i.scheduled_at).toLocaleDateString("es-ES")
          : null;
        const cust = partyName(i.customers, i.id.slice(0, 8));
        installationLabel.set(i.id, when ? `${cust} (${when})` : cust);
      }
    }
    if (maintenanceIds.size > 0) {
      const { data } = await admin
        .from("maintenance_jobs")
        .select(
          "id, completed_at, customers(legal_name, trade_name, first_name, last_name)",
        )
        .in("id", Array.from(maintenanceIds));
      type MR = {
        id: string;
        completed_at: string | null;
        customers: PartyLike | null;
      };
      for (const j of (data ?? []) as MR[]) {
        const when = j.completed_at
          ? new Date(j.completed_at).toLocaleDateString("es-ES")
          : null;
        const cust = partyName(j.customers, j.id.slice(0, 8));
        maintenanceLabel.set(j.id, when ? `${cust} (${when})` : cust);
      }
    }
    if (incidentIds.size > 0) {
      const { data } = await admin
        .from("incidents")
        .select(
          "id, title, customers(legal_name, trade_name, first_name, last_name)",
        )
        .in("id", Array.from(incidentIds));
      type INR = {
        id: string;
        title: string | null;
        customers: PartyLike | null;
      };
      for (const inc of (data ?? []) as INR[]) {
        const cust = partyName(inc.customers, inc.id.slice(0, 8));
        incidentLabel.set(inc.id, inc.title ? `${inc.title} · ${cust}` : cust);
      }
    }

    // Nombre del usuario
    const { data: prof } = await admin
      .from("user_profiles")
      .select("full_name")
      .eq("user_id", userId)
      .maybeSingle();
    const userName =
      (prof as { full_name: string | null } | null)?.full_name ??
      userId.slice(0, 8);

    // Componer líneas + agregados
    let totalPoints = 0;
    let totalEquipments = 0;
    const lines: PointsBreakdownLine[] = parsed.map((r) => {
      totalPoints += r.points;
      if (SALE_REASONS.has(r.reason) && r.metadata) {
        const eq = r.metadata.equipments;
        if (typeof eq === "number" && eq > 0) totalEquipments += eq;
      }
      let label: string | null = null;
      if (r.subject_type === "contract" && r.subject_id)
        label = contractLabel.get(r.subject_id) ?? null;
      else if (r.subject_type === "lead" && r.subject_id)
        label = leadLabel.get(r.subject_id) ?? null;
      else if (r.subject_type === "installation" && r.subject_id)
        label = installationLabel.get(r.subject_id) ?? null;
      else if (r.subject_type === "maintenance" && r.subject_id)
        label = maintenanceLabel.get(r.subject_id) ?? null;
      else if (r.subject_type === "incident" && r.subject_id)
        label = incidentLabel.get(r.subject_id) ?? null;
      return {
        id: r.id,
        awarded_at: r.awarded_at,
        reason: r.reason,
        points: r.points,
        subject_type: r.subject_type,
        subject_id: r.subject_id,
        contract_id: r.contract_id,
        installation_id: r.installation_id,
        subject_label: label,
        metadata: r.metadata,
      };
    });

    return {
      ok: true,
      data: {
        user_id: userId,
        user_name: userName,
        year: y,
        month: m,
        total_points: totalPoints,
        total_equipments: totalEquipments,
        lines,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error" };
  }
}
