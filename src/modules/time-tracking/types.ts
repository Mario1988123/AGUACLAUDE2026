export type PunchKind = "clock_in" | "clock_out" | "break_start" | "break_end";

export interface PunchRow {
  id: string;
  user_id: string;
  punch_kind: PunchKind;
  punched_at: string;
  geo_latitude: number | null;
  geo_longitude: number | null;
  needs_geo_review: boolean;
  is_manual: boolean;
  manual_reason: string | null;
  auto_closed: boolean;
  edited_by_admin: string | null;
  edited_reason: string | null;
}

export interface DayPunch {
  id: string;
  kind: PunchKind;
  at: string;
  needs_geo_review: boolean;
  auto_closed: boolean;
  edited_reason: string | null;
}

export interface ClockExtended {
  status: "working" | "stopped" | "on_break";
  since?: string;
  shift?: { starts_at: string; ends_at: string } | null;
  canPunch: boolean;
  reason?: string;
}

export interface AdminPunchRow extends PunchRow {
  user_name: string | null;
}
