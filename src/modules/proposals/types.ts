import type { ProposalStatus } from "./schemas";

export interface ProposalListItem {
  id: string;
  reference_code: string | null;
  status: ProposalStatus;
  customer_id: string | null;
  lead_id: string | null;
  customer_or_lead_name: string;
  total_cash_cents: number | null;
  validity_until: string | null;
  created_at: string;
  version_number: number;
  /** true si esta propuesta ya tiene un contrato generado (no borrado). */
  has_contract?: boolean;
}

export interface ProposalDetail extends ProposalListItem {
  parent_proposal_id: string | null;
  superseded_at: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  rejected_reason: string | null;
  monthly_renting_min_cents: number | null;
  monthly_renting_max_cents: number | null;
  monthly_rental_cents: number | null;
  notes: string | null;
  internal_notes: string | null;
}

export interface ProposalItem {
  id: string;
  proposal_id: string;
  product_id: string;
  product_name_snapshot: string;
  quantity: number;
  unit_price_cash_cents: number | null;
  notes: string | null;
}
