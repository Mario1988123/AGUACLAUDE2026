import { redirect } from "next/navigation";
import { requireSession } from "@/shared/lib/auth/session";
import { esSoloTecnico } from "@/shared/lib/auth/role-scope";

/**
 * El técnico no ve almacenes ni productos (2026-11-12): solo su furgoneta,
 * en /mi-furgoneta, sin cantidades.
 */
export default async function SoloOficinaLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (esSoloTecnico(session)) redirect("/mi-furgoneta" as never);
  return <>{children}</>;
}
