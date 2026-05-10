"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/shared/lib/supabase/admin";
import { requireSession } from "@/shared/lib/auth/session";
import { getPointsSettings } from "./award";
import { computeCycleRange } from "./cycles-utils";

async function ensureManager() {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const can =
    session.is_superadmin ||
    session.roles.includes("company_admin") ||
    session.roles.includes("commercial_director");
  if (!can) throw new Error("Solo admin o director comercial");
  return session;
}

async function getOrCreateCurrentCycle(): Promise<{ id: string }> {
  const session = await requireSession();
  if (!session.company_id) throw new Error("Sin empresa");
  const settings = await getPointsSettings(session.company_id);
  const range = computeCycleRange(new Date(), settings.cycle_close_day ?? 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: existing } = await admin
    .from("points_cycles")
    .select("id")
    .eq("company_id", session.company_id)
    .eq("cycle_year", range.cycle_year)
    .eq("cycle_month", range.cycle_month)
    .maybeSingle();
  if (existing?.id) return { id: existing.id as string };
  const { data: created, error } = await admin
    .from("points_cycles")
    .insert({
      company_id: session.company_id,
      cycle_year: range.cycle_year,
      cycle_month: range.cycle_month,
      cycle_start_at: range.start_at.toISOString(),
      cycle_end_at: range.end_at.toISOString(),
      close_day: settings.cycle_close_day ?? 0,
      status: "open",
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: (created as { id: string }).id };
}

export interface CycleSummary {
  id: string;
  cycle_year: number;
  cycle_month: number;
  cycle_start_at: string;
  cycle_end_at: string;
  status: "open" | "pending_review" | "closed";
  close_day: number;
  closed_at: string | null;
  closed_by: string | null;
  closed_by_name: string | null;
  total_points: number;
  total_cents: number;
}

export async function listCycles(): Promise<CycleSummary[]> {
  const session = await requireSession();
  if (!session.company_id) return [];
  // Garantizar que el ciclo actual existe
  await getOrCreateCurrentCycle().catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("points_cycles")
    .select(
      "id, cycle_year, cycle_month, cycle_start_at, cycle_end_at, status, close_day, closed_at, closed_by, total_points, total_cents",
    )
    .eq("company_id", session.company_id)
    .order("cycle_year", { ascending: false })
    .order("cycle_month", { ascending: false })
    .limit(36);
  type Row = Omit<CycleSummary, "closed_by_name">;
  const rows = (data ?? []) as Row[];
  // Resolver nombres de cerradores
  const closerIds = Array.from(
    new Set(rows.map((r) => r.closed_by).filter((v): v is string => !!v)),
  );
  const nameMap = new Map<string, string>();
  if (closerIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name")
      .in("user_id", closerIds);
    for (const p of (profiles ?? []) as Array<{ user_id: string; full_name: string | null }>) {
      nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
    }
  }
  return rows.map((r) => ({
    ...r,
    closed_by_name: r.closed_by ? nameMap.get(r.closed_by) ?? null : null,
  }));
}

export interface LedgerLine {
  ledger_id: string;
  points: number;
  reason: string;
  awarded_at: string;
  subject_type: string | null;
  subject_id: string | null;
}

export interface CycleAdjustment {
  id: string;
  ledger_entry_id: string | null;
  delta_points: number;
  reason: string;
  adjusted_by: string;
  adjusted_by_name: string | null;
  adjusted_at: string;
}

export interface UserCycleDetail {
  user_id: string;
  user_name: string;
  department: string | null;
  base_points: number;
  adjustments_total: number;
  net_points: number;
  net_cents: number;
  lines: LedgerLine[];
  adjustments: CycleAdjustment[];
}

export interface CycleDetail {
  cycle: CycleSummary;
  euros_per_point: number;
  users: UserCycleDetail[];
  total_points: number;
  total_cents: number;
}

export async function getCycleDetail(cycleId: string): Promise<CycleDetail | null> {
  const session = await requireSession();
  if (!session.company_id) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: cycleRow } = await admin
    .from("points_cycles")
    .select(
      "id, cycle_year, cycle_month, cycle_start_at, cycle_end_at, status, close_day, closed_at, closed_by, total_points, total_cents",
    )
    .eq("id", cycleId)
    .eq("company_id", session.company_id)
    .maybeSingle();
  if (!cycleRow) return null;
  const cycle = cycleRow as Omit<CycleSummary, "closed_by_name">;

  const settings = await getPointsSettings(session.company_id);
  const eurosPerPoint = settings.euros_per_point ?? 0;

  // Líneas del ledger del rango
  const { data: ledgerRows } = await admin
    .from("points_ledger")
    .select(
      "id, user_id, points, reason, subject_type, subject_id, awarded_at",
    )
    .eq("company_id", session.company_id)
    .gte("awarded_at", cycle.cycle_start_at)
    .lt("awarded_at", cycle.cycle_end_at)
    .order("awarded_at", { ascending: false });
  type LR = {
    id: string;
    user_id: string;
    points: number;
    reason: string;
    subject_type: string | null;
    subject_id: string | null;
    awarded_at: string;
  };
  const ledger = (ledgerRows ?? []) as LR[];

  // Ajustes del ciclo
  const { data: adjRows } = await admin
    .from("points_cycle_adjustments")
    .select("id, user_id, ledger_entry_id, delta_points, reason, adjusted_by, adjusted_at")
    .eq("cycle_id", cycleId)
    .eq("company_id", session.company_id);
  type AR = {
    id: string;
    user_id: string;
    ledger_entry_id: string | null;
    delta_points: number;
    reason: string;
    adjusted_by: string;
    adjusted_at: string;
  };
  const adjustments = (adjRows ?? []) as AR[];

  // Resolver nombres y department
  const userIds = Array.from(
    new Set([
      ...ledger.map((r) => r.user_id),
      ...adjustments.map((r) => r.user_id),
      ...adjustments.map((r) => r.adjusted_by),
      ...(cycle.closed_by ? [cycle.closed_by] : []),
    ]),
  );
  const nameMap = new Map<string, string>();
  const deptMap = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: profiles } = await admin
      .from("user_profiles")
      .select("user_id, full_name, department")
      .in("user_id", userIds);
    for (const p of (profiles ?? []) as Array<{
      user_id: string;
      full_name: string | null;
      department: string | null;
    }>) {
      nameMap.set(p.user_id, p.full_name ?? p.user_id.slice(0, 8));
      deptMap.set(p.user_id, p.department ?? null);
    }
  }

  // Agrupar por usuario
  const usersMap = new Map<string, UserCycleDetail>();
  function ensure(userId: string): UserCycleDetail {
    let u = usersMap.get(userId);
    if (!u) {
      u = {
        user_id: userId,
        user_name: nameMap.get(userId) ?? userId.slice(0, 8),
        department: deptMap.get(userId) ?? null,
        base_points: 0,
        adjustments_total: 0,
        net_points: 0,
        net_cents: 0,
        lines: [],
        adjustments: [],
      };
      usersMap.set(userId, u);
    }
    return u;
  }
  for (const l of ledger) {
    const u = ensure(l.user_id);
    u.base_points += l.points;
    u.lines.push({
      ledger_id: l.id,
      points: l.points,
      reason: l.reason,
      awarded_at: l.awarded_at,
      subject_type: l.subject_type,
      subject_id: l.subject_id,
    });
  }
  for (const a of adjustments) {
    const u = ensure(a.user_id);
    u.adjustments_total += a.delta_points;
    u.adjustments.push({
      id: a.id,
      ledger_entry_id: a.ledger_entry_id,
      delta_points: a.delta_points,
      reason: a.reason,
      adjusted_by: a.adjusted_by,
      adjusted_by_name: nameMap.get(a.adjusted_by) ?? null,
      adjusted_at: a.adjusted_at,
    });
  }
  for (const u of usersMap.values()) {
    u.net_points = u.base_points + u.adjustments_total;
    u.net_cents = Math.round(u.net_points * eurosPerPoint * 100);
  }
  const users = Array.from(usersMap.values()).sort(
    (a, b) => b.net_points - a.net_points,
  );
  const total_points = users.reduce((s, u) => s + u.net_points, 0);
  const total_cents = users.reduce((s, u) => s + u.net_cents, 0);

  return {
    cycle: { ...cycle, closed_by_name: cycle.closed_by ? nameMap.get(cycle.closed_by) ?? null : null },
    euros_per_point: eurosPerPoint,
    users,
    total_points,
    total_cents,
  };
}

export async function adjustCycleLine(args: {
  cycle_id: string;
  user_id: string;
  ledger_entry_id?: string | null;
  delta_points: number;
  reason: string;
}): Promise<void> {
  const session = await ensureManager();
  if (!Number.isFinite(args.delta_points) || args.delta_points === 0) {
    throw new Error("El delta debe ser distinto de 0");
  }
  if (!args.reason || args.reason.trim().length < 3) {
    throw new Error("Indica una razón clara para el ajuste");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: cycle } = await admin
    .from("points_cycles")
    .select("id, status, company_id")
    .eq("id", args.cycle_id)
    .maybeSingle();
  if (!cycle) throw new Error("Ciclo no encontrado");
  if ((cycle as { company_id: string }).company_id !== session.company_id) {
    throw new Error("Ciclo de otra empresa");
  }
  if ((cycle as { status: string }).status === "closed") {
    throw new Error("El ciclo está cerrado, no se admiten ajustes");
  }
  await admin.from("points_cycle_adjustments").insert({
    company_id: session.company_id,
    cycle_id: args.cycle_id,
    user_id: args.user_id,
    ledger_entry_id: args.ledger_entry_id ?? null,
    delta_points: Math.round(args.delta_points),
    reason: args.reason.trim(),
    adjusted_by: session.user_id,
  });
  revalidatePath(`/comisiones/${args.cycle_id}`);
  revalidatePath("/comisiones");
}

export async function closeCycle(cycleId: string): Promise<void> {
  const session = await ensureManager();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const detail = await getCycleDetail(cycleId);
  if (!detail) throw new Error("Ciclo no encontrado");
  if (detail.cycle.status === "closed") throw new Error("Ya estaba cerrado");
  if (new Date(detail.cycle.cycle_end_at).getTime() > Date.now()) {
    throw new Error("El ciclo aún no ha terminado, espera al cierre del periodo");
  }
  await admin
    .from("points_cycles")
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
      closed_by: session.user_id,
      total_points: detail.total_points,
      total_cents: detail.total_cents,
    })
    .eq("id", cycleId)
    .eq("company_id", session.company_id);
  revalidatePath(`/comisiones/${cycleId}`);
  revalidatePath("/comisiones");
}

export async function reopenCycle(cycleId: string, reason: string): Promise<void> {
  const session = await ensureManager();
  if (!reason || reason.trim().length < 3) throw new Error("Indica una razón para reabrir");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: cycle } = await admin
    .from("points_cycles")
    .select("id, status, company_id, notes")
    .eq("id", cycleId)
    .maybeSingle();
  if (!cycle) throw new Error("Ciclo no encontrado");
  if ((cycle as { company_id: string }).company_id !== session.company_id) {
    throw new Error("Ciclo de otra empresa");
  }
  if ((cycle as { status: string }).status !== "closed") {
    throw new Error("El ciclo no está cerrado");
  }
  const prevNotes = (cycle as { notes: string | null }).notes ?? "";
  const newNotes = `${prevNotes}\n[${new Date().toISOString()}] Reabierto por ${session.user_id}: ${reason.trim()}`.trim();
  await admin
    .from("points_cycles")
    .update({
      status: "pending_review",
      closed_at: null,
      closed_by: null,
      notes: newNotes,
    })
    .eq("id", cycleId)
    .eq("company_id", session.company_id);
  revalidatePath(`/comisiones/${cycleId}`);
  revalidatePath("/comisiones");
}
