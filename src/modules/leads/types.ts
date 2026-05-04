import type { LEAD_ORIGIN, LEAD_POTENTIAL, LEAD_STATUS } from "./schemas";

export type LeadStatus = (typeof LEAD_STATUS)[number];
export type LeadOrigin = (typeof LEAD_ORIGIN)[number];
export type LeadPotential = (typeof LEAD_POTENTIAL)[number];
export type PartyKind = "individual" | "company";

export interface LeadListItem {
  id: string;
  party_kind: PartyKind;
  display_name: string;
  /** Razón social literal (puede no coincidir con display_name si tiene trade_name) */
  legal_name: string | null;
  /** Si es empresa: nombre del contacto (first_name + last_name) bajo el nombre comercial */
  contact_name: string | null;
  email: string | null;
  phone_primary: string | null;
  status: LeadStatus;
  origin: LeadOrigin;
  potential: LeadPotential;
  assigned_user_id: string | null;
  created_at: string;
  days_since_created: number;
  tags: string[];
  /** Dirección principal si está cargada */
  address_street: string | null;
  address_city: string | null;
  address_province: string | null;
  address_lat: number | null;
  address_lng: number | null;
  /** true si el lead tiene al menos 1 propuesta asociada (no eliminada) */
  has_proposals?: boolean;
}

export interface LeadDetail extends Omit<LeadListItem, "display_name" | "days_since_created"> {
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone_company: string | null;
  tax_id: string | null;
  notes: string | null;
  origin_tmk_user_id: string | null;
  converted_to_customer_id: string | null;
  lost_reason: string | null;
  updated_at: string;
}
