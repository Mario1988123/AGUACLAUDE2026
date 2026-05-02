import { NextResponse } from "next/server";
import { createClient } from "@/shared/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Logout SOLO por POST. Si exponemos GET, Next.js Link prefetch puede
 * desloguear automáticamente al renderizar el enlace de "Salir".
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (supabase as any).auth?.signOut === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).auth.signOut();
  }
  const url = new URL("/login", request.url);
  return NextResponse.redirect(url, { status: 303 });
}

// GET responde 405 para evitar logout por prefetch
export async function GET() {
  return new NextResponse("Use POST", { status: 405, headers: { Allow: "POST" } });
}
