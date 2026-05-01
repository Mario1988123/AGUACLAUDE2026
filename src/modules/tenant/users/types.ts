import type { RoleKey } from "./schemas";

export interface TenantUser {
  user_id: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  job_title: string | null;
  status: "invited" | "active" | "inactive" | "suspended";
  roles: RoleKey[];
  last_login_at: string | null;
  created_at: string;
}
