import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { esSoloTecnico } from "@/shared/lib/auth/role-scope";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Dev local autologin: directo al superadmin
  if (
    process.env.NODE_ENV === "development" &&
    process.env.NEXT_PUBLIC_LOCAL_AUTOLOGIN === "true"
  ) {
    redirect("/superadmin");
  }

  const session = await requireSession();
  if (session.is_superadmin) redirect("/superadmin");
  // El técnico empieza en Mi día (2026-11-12): el dashboard es de ventas.
  if (esSoloTecnico(session)) redirect("/mi-dia");
  redirect("/dashboard");
}
