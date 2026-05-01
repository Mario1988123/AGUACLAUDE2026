export type CompanyStatus = "trial" | "active" | "suspended" | "cancelled";

export interface CompanyListItem {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  max_users: number;
  max_storage_mb: number;
  monthly_cost_cents: number;
  billing_email: string | null;
  created_at: string;
}

export interface CompanyDetail extends CompanyListItem {
  fiscal_data: Record<string, string | null>;
  primary_color: string | null;
  logo_url: string | null;
  activated_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
}
