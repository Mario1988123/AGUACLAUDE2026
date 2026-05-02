import { NextResponse } from "next/server";
import { createClient } from "@/shared/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  // signOut puede no existir si el cliente es un service_role en dev autologin
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (supabase as any).auth?.signOut === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).auth.signOut();
  }
  const url = new URL("/login", request.url);
  return NextResponse.redirect(url);
}
