export interface CustomerListItem {
  id: string;
  party_kind: "individual" | "company";
  /** Solo aplica si party_kind=company. Usado para elegir precio empresa/IVA. */
  is_autonomo?: boolean;
  display_name: string;
  /** Para empresas: persona de contacto (first + last). */
  contact_name: string | null;
  email: string | null;
  phone_primary: string | null;
  is_active: boolean;
  created_at: string;
  // Dirección primaria
  address_street: string | null;
  address_city: string | null;
  address_province: string | null;
  address_lat: number | null;
  address_lng: number | null;
  /** Equipos instalados — primer producto + cantidad total. */
  equipment_summary: string | null;
  equipment_count: number;
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
