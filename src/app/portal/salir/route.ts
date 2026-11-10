import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/shared/lib/supabase/server";

// Cierra la sesión del portal y vuelve a la pantalla de entrada.
// GET para poder usarlo como enlace y como destino de redirect desde un
// componente de servidor (que no puede borrar cookies).
async function salir(request: NextRequest) {
  const supabase = await createClient();
  // scope local: solo este navegador (un enlace ajeno no puede cerrar las
  // sesiones de otros dispositivos).
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  const motivo = request.nextUrl.searchParams.get("motivo") === "desactivado" ? "desactivado" : "salida";
  const url = request.nextUrl.clone();
  url.pathname = "/portal/entrar";
  url.search = `?motivo=${motivo}`;
  const res = NextResponse.redirect(url, { status: 303 });
  // Si signOut falló sin borrar las cookies, las borramos a mano: si no,
  // /portal/entrar → /portal → /portal/salir entraría en bucle.
  for (const c of request.cookies.getAll()) {
    if (c.name.startsWith("sb-")) res.cookies.set(c.name, "", { path: "/", maxAge: 0 });
  }
  return res;
}

export const GET = salir;
export const POST = salir;
