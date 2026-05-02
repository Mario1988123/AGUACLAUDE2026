import type { ContractStatus } from "./schemas";

export interface ContractListItem {
  id: string;
  reference_code: string | null;
  status: ContractStatus;
  customer_id: string;
  customer_name: string;
  plan_type: "cash" | "renting" | "rental";
  total_cash_cents: number | null;
  monthly_cents: number | null;
  signed_at: string | null;
  created_at: string;
}

export interface ContractDetail {
  id: string;
  reference_code: string | null;
  status: ContractStatus;
  customer_id: string;
  source_proposal_id: string | null;
  source_free_trial_id: string | null;
  plan_type: "cash" | "renting" | "rental";
  duration_months: number | null;
  permanence_months: number | null;
  total_cash_cents: number | null;
  monthly_cents: number | null;
  has_provisional_data: boolean;
  signed_at: string | null;
  service_start_date: string | null;
  maintenance_included: boolean;
  maintenance_months_included: number | null;
  maintenance_periodicity_months: number | null;
  maintenance_extra_cents: number | null;
  customer_snapshot: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
}
