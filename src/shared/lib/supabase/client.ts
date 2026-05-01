"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/shared/lib/env";
import type { Database } from "@/shared/types/database.types";

export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
