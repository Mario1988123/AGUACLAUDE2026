import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/shared/lib/env";
import type { Database } from "@/shared/types/database.types";
import { isPublicPath } from "./public-paths";

/**
 * Siguiente respuesta con la cabecera `x-pathname`, que lee el guard de rutas
 * de `app/(tenant)/layout.tsx` (2026-11-12). Se clona en cada llamada para no
 * perder las cookies que Supabase haya refrescado en `request`.
 */
function siguiente(request: NextRequest): NextResponse {
  const h = new Headers(request.headers);
  h.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: h } });
}

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
    return siguiente(request);
  }

  let supabaseResponse = siguiente(request);

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
          supabaseResponse = siguiente(request);
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

  // Rutas públicas (solo aplica a GET): ver public-paths.ts
  const isPublic = isPublicPath(pathname);

  // Portal de clientes: sin sesión va a su propia entrada (con DNI), no al
  // login de empleados; con sesión, la entrada lleva al portal.
  if (pathname === "/portal" || pathname.startsWith("/portal/")) {
    if (!user && !isPublic) {
      url.pathname = "/portal/entrar";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (user && pathname === "/portal/entrar") {
      url.pathname = "/portal";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

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
