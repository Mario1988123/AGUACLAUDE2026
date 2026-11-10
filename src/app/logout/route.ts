import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/shared/lib/supabase/server";
import { createAdminClient } from "@/shared/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** La escribe registrarTokenDispositivoAction (push-actions.ts). */
const COOKIE_TOKEN_DISPOSITIVO = "hm_push_token";

/**
 * Logout SOLO por POST. Si exponemos GET, Next.js Link prefetch puede
 * desloguear automáticamente al renderizar el enlace de "Salir".
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  // App móvil: al cerrar sesión, este dispositivo deja de recibir los avisos
  // del usuario que se va. Nunca debe impedir el cierre de sesión.
  let habiaToken = false;
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE_TOKEN_DISPOSITIVO)?.value;
    if (token) {
      habiaToken = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).auth.getUser();
      const userId = data?.user?.id as string | undefined;
      if (userId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (createAdminClient() as any)
          .from("push_device_tokens")
          .delete()
          .eq("token", token)
          .eq("user_id", userId);
      }
    }
  } catch {
    /* fail-soft */
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (supabase as any).auth?.signOut === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).auth.signOut();
  }
  const url = new URL("/login", request.url);
  const respuesta = NextResponse.redirect(url, { status: 303 });
  if (habiaToken) respuesta.cookies.delete(COOKIE_TOKEN_DISPOSITIVO);
  return respuesta;
}

// GET responde 405 para evitar logout por prefetch
export async function GET() {
  return new NextResponse("Use POST", { status: 405, headers: { Allow: "POST" } });
}
