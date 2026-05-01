"use server";

import { createClient } from "@/shared/lib/supabase/server";
import { requireSession } from "@/shared/lib/auth/session";

export interface WarehouseRow {
  id: string;
  name: string;
  kind: "main" | "secondary" | "vehicle" | "external_supplier";
  vehicle_plate: string | null;
  assigned_user_id: string | null;
  is_active: boolean;
}

export async function listWarehouses(): Promise<WarehouseRow[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("warehouses")
    .select("id, name, kind, vehicle_plate, assigned_user_id, is_active")
    .is("deleted_at", null)
    .order("kind")
    .order("name");
  if (error) throw error;
  return (data ?? []) as WarehouseRow[];
}

export interface LoadingRequestRow {
  id: string;
  status: string;
  source_warehouse_id: string;
  destination_warehouse_id: string;
  needed_for: string | null;
  created_at: string;
}

export async function listLoadingRequests(): Promise<LoadingRequestRow[]> {
  await requireSession();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loading_requests")
    .select("id, status, source_warehouse_id, destination_warehouse_id, needed_for, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as LoadingRequestRow[];
}
