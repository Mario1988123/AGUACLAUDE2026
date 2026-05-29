import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/shared/lib/env";
import type { Database } from "@/shared/types/database.types";

export async function updateSession(request: NextRequest) {
  // Bypass de auth en local dev (ver .env.local NEXT_PUBLIC_LOCAL_AUTOLOGIN)
  if (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_LOCAL_AUTOLOGIN === "true"
  ) {
    const url = request.nextUrl.clone();
    if (url.pathname === "/login" || url.pathname === "/") {
      url.pathname = "/superadmin";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const url = request.nextUrl.clone();
  const pathname = url.pathname;

  // En métodos no-GET (server actions, form posts) NUNCA redirigimos a /login.
  // El handler / server action verifica auth con requireSession() y devuelve
  // su propia respuesta. Si redirigiéramos aquí, el cliente recibiría HTML
  // de /login en vez de la respuesta esperada por la server action y rompería
  // con "An unexpected response was received from the server".
  if (request.method !== "GET") {
    return supabaseResponse;
  }

  // Rutas públicas (solo aplica a GET):
  //  · /login + recuperación de contraseña
  //  · /api/health para uptime checks
  //  · /m/[token] — confirmación pública de mantenimiento por cliente
  //  · /i/[token] — confirmación pública de instalación por cliente
  //  · /firmar-contrato — firma remota de contrato
  const PUBLIC_PATHS = [
    "/login",
    "/recuperar-password",
    "/restablecer-password",
    "/api/health",
    "/m/",
    "/i/",
    "/firmar-contrato",
    "/baja", // baja de comunicaciones comerciales (link en emails de campaña)
    "/api/webhooks/", // webhooks externos (Resend, GoCardless) verifican su propia firma
    "/api/track/", // tracking de aperturas/clics SMTP (pixel + redirect)
  ];
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
