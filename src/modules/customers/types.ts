export interface CustomerListItem {
  id: string;
  party_kind: "individual" | "company";
  display_name: string;
  email: string | null;
  phone_primary: string | null;
  is_active: boolean;
  created_at: string;
}

export interface CustomerDetail {
  id: string;
  party_kind: "individual" | "company";
  legal_name: string | null;
  trade_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_primary: string | null;
  phone_secondary: string | null;
  tax_id: string | null;
  notes: string | null;
  is_active: boolean;
  source_lead_id: string | null;
  assigned_user_id: string | null;
  created_at: string;
  updated_at: string;
}
